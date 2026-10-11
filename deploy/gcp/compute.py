#!/usr/bin/env python3
"""Create private public-app/worker compute after foundation provisioning.

Autoscaling is configured but disabled until a healthy HTTPS deployment exists.
Template names include the image digest so existing releases are not modified.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--region", default="asia-south2")
    parser.add_argument("--image", required=True, help="Artifact Registry image pinned with @sha256:digest")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9.-]+/[a-z0-9/_-]+@sha256:[a-f0-9]{64}", args.image):
        parser.error("image must use an immutable SHA256 digest")
    zone = args.region + "-a"
    startup = Path(__file__).with_name("bootstrap.sh").resolve()
    revision = hashlib.sha256((args.image + startup.read_text()).encode()).hexdigest()[:12]
    email = f"gte-runtime@{args.project}.iam.gserviceaccount.com"

    def run(command, check=True):
        result = subprocess.run(["gcloud", *command, f"--project={args.project}", "--quiet"], capture_output=True, text=True)
        if check and result.returncode:
            raise RuntimeError(result.stderr)
        return result

    def ensure(label, describe, create):
        result = run([*describe, "--format=json"], check=False)
        if result.returncode == 0:
            print(f"Reusing {label}", flush=True)
            return json.loads(result.stdout or "{}")
        if not any(x in result.stderr for x in ("NOT_FOUND", "not found", "does not exist", "Not Found", "notFound")):
            raise RuntimeError(result.stderr)
        print(f"Creating {label}", flush=True)
        run(create)
        return None

    common = [f"--subnet=projects/{args.project}/regions/{args.region}/subnetworks/gte-app", "--no-address", "--image-family=debian-12", "--image-project=debian-cloud", "--boot-disk-size=30GB", "--boot-disk-type=pd-balanced", f"--service-account={email}", "--scopes=cloud-platform", "--shielded-secure-boot", "--metadata=enable-oslogin=TRUE,block-project-ssh-keys=TRUE", f"--metadata-from-file=startup-script={startup}"]
    template = f"gte-web-{revision}"
    # Duplicate --metadata flags are avoided; role/image extend the shared value.
    metadata = f"--metadata=enable-oslogin=TRUE,block-project-ssh-keys=TRUE,gte-role=gateway,gte-image={args.image}"
    ensure("public app template", ["compute", "instance-templates", "describe", template],
           ["compute", "instance-templates", "create", template, "--machine-type=n2-standard-2", "--tags=gte,gte-web", *[v for v in common if not v.startswith("--metadata=")], metadata])
    group = ensure("public app managed group", ["compute", "instance-groups", "managed", "describe", "gte-web", f"--region={args.region}"],
           ["compute", "instance-groups", "managed", "create", "gte-web", f"--region={args.region}", f"--template={template}", "--size=1", f"--zones={args.region}-a,{args.region}-b,{args.region}-c", "--target-distribution-shape=even"])
    templates = [] if not group else [group.get("instanceTemplate", ""), *[v.get("instanceTemplate", "") for v in group.get("versions", [])]]
    if group and not any(t.endswith("/" + template) for t in templates):
        raise SystemExit("Existing group uses another image: perform an explicit rolling release; not replacing it automatically")
    run(["compute", "instance-groups", "managed", "set-named-ports", "gte-web", f"--region={args.region}", "--named-ports=http:8080"])
    # This creates an autoscaling policy without causing idle, unconfigured
    # Machines to be interpreted as usable application capacity.
    if group is None:
        run(["compute", "instance-groups", "managed", "set-autoscaling", "gte-web", f"--region={args.region}", "--min-num-replicas=1", "--max-num-replicas=3", "--target-cpu-utilization=0.65", "--cool-down-period=300", "--mode=off"])
    ensure("worker VM", ["compute", "instances", "describe", "gte-worker", f"--zone={zone}"],
           ["compute", "instances", "create", "gte-worker", f"--zone={zone}", "--machine-type=e2-highcpu-2", "--tags=gte,gte-worker", *[v for v in common if not v.startswith("--metadata=")], f"--metadata=enable-oslogin=TRUE,block-project-ssh-keys=TRUE,gte-role=worker,gte-image={args.image}"])
    ensure("application health check", ["compute", "health-checks", "describe", "gte-web"],
           ["compute", "health-checks", "create", "http", "gte-web", "--port=8080", "--request-path=/api/v1/health", "--check-interval=10s", "--timeout=5s", "--healthy-threshold=2", "--unhealthy-threshold=3"])
    ensure("SSE-capable backend", ["compute", "backend-services", "describe", "gte-web", "--global"],
           ["compute", "backend-services", "create", "gte-web", "--global", "--load-balancing-scheme=EXTERNAL_MANAGED", "--protocol=HTTP", "--port-name=http", "--health-checks=gte-web", "--timeout=3600s", "--connection-draining-timeout=60s"])
    backend = json.loads(run(["compute", "backend-services", "describe", "gte-web", "--global", "--format=json"]).stdout)
    if not backend.get("backends"):
        run(["compute", "backend-services", "add-backend", "gte-web", "--global", "--instance-group=gte-web", f"--instance-group-region={args.region}", "--balancing-mode=UTILIZATION", "--max-utilization=0.8"])
    ensure("URL map", ["compute", "url-maps", "describe", "gte-web"],
           ["compute", "url-maps", "create", "gte-web", "--default-service=gte-web"])
    print("Compute prepared; HTTPS forwarding and autoscaling activation await deployment configuration.", flush=True)


if __name__ == "__main__":
    main()
