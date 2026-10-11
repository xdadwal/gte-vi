#!/usr/bin/env python3
"""Provision the shared GCP foundation. Requires authenticated gcloud, not SDK keys.

Existing resources are reused; configuration drift must be reviewed separately.
Database and Redis creation are asynchronous. No application is published here.
"""
import argparse
import json
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--region", default="asia-south2")
    args = parser.parse_args()

    def run(command, check=True):
        result = subprocess.run(
            ["gcloud", *command, f"--project={args.project}", "--quiet"],
            text=True, capture_output=True,
        )
        if check and result.returncode:
            raise RuntimeError(result.stderr)
        return result

    def ensure(label, describe, create):
        result = run([*describe, "--format=json"], check=False)
        if result.returncode == 0:
            print(f"Reusing {label}", flush=True)
            return json.loads(result.stdout or "{}")
        # Authentication, disabled APIs and permission errors must never be
        # interpreted as absence and followed by an attempted creation.
        if not any(marker in result.stderr for marker in (
            "NOT_FOUND", "not found", "does not exist", "Not Found", "notFound",
        )):
            raise RuntimeError(result.stderr)
        print(f"Creating {label}", flush=True)
        run(create)
        return None

    project, region = args.project, args.region
    network = f"projects/{project}/global/networks/gte"
    ensure("VPC", ["compute", "networks", "describe", "gte"],
           ["compute", "networks", "create", "gte", "--subnet-mode=custom"])
    ensure("application subnet", ["compute", "networks", "subnets", "describe", "gte-app", f"--region={region}"],
           ["compute", "networks", "subnets", "create", "gte-app", f"--region={region}", "--network=gte", "--range=10.20.0.0/24", "--enable-private-ip-google-access"])
    ensure("private service range", ["compute", "addresses", "describe", "gte-services", "--global"],
           ["compute", "addresses", "create", "gte-services", "--global", "--purpose=VPC_PEERING", "--addresses=10.30.0.0", "--prefix-length=16", "--network=gte"])
    peerings = json.loads(run(["services", "vpc-peerings", "list", "--network=gte", "--service=servicenetworking.googleapis.com", "--format=json"]).stdout)
    if not peerings:
        print("Connecting private services", flush=True)
        run(["services", "vpc-peerings", "connect", "--network=gte", "--ranges=gte-services", "--service=servicenetworking.googleapis.com"])
    ensure("egress router", ["compute", "routers", "describe", "gte", f"--region={region}"],
           ["compute", "routers", "create", "gte", f"--region={region}", "--network=gte"])
    ensure("Cloud NAT", ["compute", "routers", "nats", "describe", "gte-egress", "--router=gte", f"--region={region}"],
           ["compute", "routers", "nats", "create", "gte-egress", "--router=gte", f"--region={region}", "--nat-all-subnet-ip-ranges", "--auto-allocate-nat-external-ips"])
    ensure("IAP-only SSH firewall", ["compute", "firewall-rules", "describe", "gte-iap-ssh"],
           ["compute", "firewall-rules", "create", "gte-iap-ssh", "--network=gte", "--allow=tcp:22", "--source-ranges=35.235.240.0/20", "--target-tags=gte"])
    ensure("load balancer firewall", ["compute", "firewall-rules", "describe", "gte-lb-web"],
           ["compute", "firewall-rules", "create", "gte-lb-web", "--network=gte", "--allow=tcp:8080", "--source-ranges=35.191.0.0/16,130.211.0.0/22", "--target-tags=gte-web"])
    ensure("container registry", ["artifacts", "repositories", "describe", "gte", f"--location={region}"],
           ["artifacts", "repositories", "create", "gte", f"--location={region}", "--repository-format=docker", "--description=Grand Theft Elections release images"])
    for suffix in ("routing", "backups", "builds"):
        bucket = f"gs://{project}-gte-{suffix}"
        ensure(f"{suffix} bucket", ["storage", "buckets", "describe", bucket],
               ["storage", "buckets", "create", bucket, f"--location={region}", "--uniform-bucket-level-access", "--public-access-prevention"])
    email = f"gte-runtime@{project}.iam.gserviceaccount.com"
    ensure("runtime identity", ["iam", "service-accounts", "describe", email],
           ["iam", "service-accounts", "create", "gte-runtime", "--display-name=GTE runtime"])
    for role in ("roles/cloudsql.client", "roles/logging.logWriter", "roles/monitoring.metricWriter"):
        run(["projects", "add-iam-policy-binding", project, f"--member=serviceAccount:{email}", f"--role={role}", "--condition=None"])
    run(["artifacts", "repositories", "add-iam-policy-binding", "gte", f"--location={region}", f"--member=serviceAccount:{email}", "--role=roles/artifactregistry.reader"])
    run(["storage", "buckets", "add-iam-policy-binding", f"gs://{project}-gte-routing", f"--member=serviceAccount:{email}", "--role=roles/storage.objectViewer"])
    # gcloud storage rsync also reads bucket metadata (storage.buckets.get).
    run(["storage", "buckets", "add-iam-policy-binding", f"gs://{project}-gte-routing", f"--member=serviceAccount:{email}", "--role=roles/storage.legacyBucketReader"])
    builder = f"gte-build@{project}.iam.gserviceaccount.com"
    ensure("build identity", ["iam", "service-accounts", "describe", builder],
           ["iam", "service-accounts", "create", "gte-build", "--display-name=GTE image builder"])
    run(["artifacts", "repositories", "add-iam-policy-binding", "gte", f"--location={region}", f"--member=serviceAccount:{builder}", "--role=roles/artifactregistry.writer"])
    run(["storage", "buckets", "add-iam-policy-binding", f"gs://{project}-gte-builds", f"--member=serviceAccount:{builder}", "--role=roles/storage.objectUser"])
    run(["storage", "buckets", "add-iam-policy-binding", f"gs://{project}-gte-builds", f"--member=serviceAccount:{builder}", "--role=roles/storage.legacyBucketReader"])
    for secret in ("gte-database-url", "gte-redis-url", "gte-app-config"):
        ensure(secret, ["secrets", "describe", secret],
               ["secrets", "create", secret, "--replication-policy=user-managed", f"--locations={region}"])
        run(["secrets", "add-iam-policy-binding", secret, f"--member=serviceAccount:{email}", "--role=roles/secretmanager.secretAccessor"])
    ensure("Cloud SQL", ["sql", "instances", "describe", "gte-db"],
           ["sql", "instances", "create", "gte-db", f"--region={region}", "--database-version=POSTGRES_17", "--edition=ENTERPRISE", "--tier=db-custom-1-3840", "--availability-type=regional", "--storage-size=20", "--storage-type=SSD", "--storage-auto-increase", "--backup-start-time=20:00", "--retained-backups-count=7", "--enable-point-in-time-recovery", "--deletion-protection", "--no-assign-ip", f"--network={network}", "--ssl-mode=ENCRYPTED_ONLY", "--async"])
    ensure("Memorystore", ["redis", "instances", "describe", "gte-redis", f"--region={region}"],
           ["redis", "instances", "create", "gte-redis", f"--region={region}", "--tier=standard", "--size=1", "--redis-version=redis_7_2", f"--network={network}", "--connect-mode=private-service-access", "--reserved-ip-range=gte-services", "--enable-auth", "--async"])
    ensure("public load balancer address", ["compute", "addresses", "describe", "gte-web", "--global"],
           ["compute", "addresses", "create", "gte-web", "--global", "--ip-version=IPV4"])
    print("Foundation provisioned. Check asynchronous database/Redis operations before configuring runtime.", flush=True)


if __name__ == "__main__":
    main()
