#!/bin/bash
# Compute Engine startup script. Secrets are fetched with the VM identity;
# absent configuration keeps the app unpublished. Do not enable shell tracing.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq docker.io nginx curl ca-certificates gnupg python3
# No default web page should be exposed while configuration is incomplete.
rm -f /etc/nginx/sites-enabled/default
python3 - <<'PY'
from pathlib import Path
import re
p = Path('/etc/nginx/nginx.conf')
s = p.read_text()
s = re.sub(r'worker_connections\s+\d+;', 'worker_connections 16384;', s)
if 'worker_rlimit_nofile' not in s:
    s = 'worker_rlimit_nofile 131072;\n' + s
p.write_text(s)
PY
install -d /etc/systemd/system/nginx.service.d
cat > /etc/systemd/system/nginx.service.d/limits.conf <<'LIMITS'
[Service]
LimitNOFILE=131072
LIMITS
if ! command -v gcloud >/dev/null; then
  curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg |
    gpg --dearmor --yes -o /usr/share/keyrings/cloud.google.gpg
  echo 'deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main' > /etc/apt/sources.list.d/google-cloud-sdk.list
  apt-get update -qq
  apt-get install -y -qq google-cloud-cli
fi
systemctl enable --now docker
if ! systemctl list-unit-files google-cloud-ops-agent.service --no-legend | grep -q google-cloud-ops-agent; then
  curl -fsS https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh -o /tmp/gte-ops-agent.sh
  bash /tmp/gte-ops-agent.sh --also-install
fi
cat > /etc/google-cloud-ops-agent/config.yaml <<'AGENT'
logging:
  receivers:
    gte_containers:
      type: files
      include_paths:
        - /var/lib/docker/containers/*/*-json.log
  service:
    pipelines:
      gte_containers:
        receivers: [gte_containers]
AGENT
systemctl restart google-cloud-ops-agent
install -d -m 700 /etc/gte
install -d -m 755 /var/lib/gte/routing
cat > /usr/local/bin/gte-launch <<'LAUNCH'
#!/bin/bash
set -euo pipefail
umask 077
metadata=http://metadata.google.internal/computeMetadata/v1
project=$(curl -fsS -H Metadata-Flavor:Google "$metadata/project/project-id")
role=$(curl -fsS -H Metadata-Flavor:Google "$metadata/instance/attributes/gte-role")
image=$(curl -fsS -H Metadata-Flavor:Google "$metadata/instance/attributes/gte-image")
# Redirection protects credentials even if the fetch fails. The service retries
# when Secret Manager has no enabled configuration version yet.
gcloud secrets versions access latest --secret=gte-app-config --project="$project" > /etc/gte/config.json
gcloud secrets versions access latest --secret=gte-database-url --project="$project" > /etc/gte/database-url
gcloud secrets versions access latest --secret=gte-redis-url --project="$project" > /etc/gte/redis-url
python3 - "$role" <<'PY'
import ipaddress, json, pathlib, sys, urllib.parse
base = pathlib.Path('/etc/gte')
c = json.loads((base / 'config.json').read_text())
required = ('PUBLIC_ORIGIN', 'OWNER_EMAIL', 'SQL_CONNECTION_NAME', 'GRAPH_BUCKET', 'LB_IP')
if any(not isinstance(c.get(k), str) or not c[k] or '\n' in c[k] or '\r' in c[k] for k in required):
    raise SystemExit('Incomplete deployment configuration')
origin = urllib.parse.urlparse(c['PUBLIC_ORIGIN'])
if origin.scheme != 'https' or not origin.hostname or origin.path not in ('', '/') or origin.query or origin.fragment:
    raise SystemExit('PUBLIC_ORIGIN must be an HTTPS origin')
if sys.argv[1] not in ('gateway', 'worker'):
    raise SystemExit('Invalid VM application role')
lb_ip = str(ipaddress.IPv4Address(c['LB_IP']))
e = {k: c[k] for k in required if k not in ('SQL_CONNECTION_NAME', 'GRAPH_BUCKET', 'LB_IP')}
e.update(APP_ENV='production', APP_ROLE=sys.argv[1], LISTEN_ADDR='127.0.0.1:8081', WEB_DIR='/app/web', GRAPH_DIR='/app/routing', TRUSTED_PROXY_CIDRS='127.0.0.1/32')
e['DATABASE_URL'] = (base / 'database-url').read_text().strip() + '&pool_max_conns=' + ('5' if sys.argv[1] == 'worker' else '10')
e['REDIS_URL'] = (base / 'redis-url').read_text().strip()
if any('\n' in v or '\r' in v for v in e.values()):
    raise SystemExit('Multiline environment values are unsupported')
(base / 'runtime.env').write_text(''.join(f'{k}={v}\n' for k,v in e.items()))
pathlib.Path('/etc/nginx/sites-enabled/gte').write_text('''server {
    listen 8080;
    large_client_header_buffers 4 64k;
    set_real_ip_from 35.191.0.0/16;
    set_real_ip_from 130.211.0.0/22;
    set_real_ip_from ''' + lb_ip + ''';
    real_ip_header X-Forwarded-For;
    real_ip_recursive on;
    access_log off;
    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_read_timeout 90s;
    }
}
''')
PY
connection=$(python3 -c 'import json; print(json.load(open("/etc/gte/config.json"))["SQL_CONNECTION_NAME"])')
bucket=$(python3 -c 'import json; print(json.load(open("/etc/gte/config.json"))["GRAPH_BUCKET"])')
registry=${image%%/*}
gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin "https://$registry" >/dev/null
docker pull "$image" >/dev/null
docker pull gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.26.0 >/dev/null
if [ "$role" = gateway ]; then
  gcloud storage rsync --recursive "$bucket" /var/lib/gte/routing >/dev/null
  test -s /var/lib/gte/routing/manifest.json
fi
docker rm -f gte-sql gte-app >/dev/null 2>&1 || true
docker run -d --name gte-sql --restart=unless-stopped --network=host \
  --log-opt max-size=10m --log-opt max-file=3 \
  gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.26.0 \
  --private-ip --address=127.0.0.1 --port=5432 "$connection" >/dev/null
memory=6g
if [ "$role" = worker ]; then memory=1g; fi
docker run -d --name gte-app --restart=unless-stopped --network=host \
  --memory="$memory" --memory-swap="$memory" \
  --ulimit nofile=131072:131072 --env-file=/etc/gte/runtime.env \
  --log-opt max-size=10m --log-opt max-file=3 \
  -v /var/lib/gte/routing:/app/routing:ro "$image" >/dev/null
nginx -t
systemctl restart nginx
LAUNCH
chmod 700 /usr/local/bin/gte-launch
cat > /etc/systemd/system/gte-launch.service <<'SERVICE'
[Unit]
Description=Start Grand Theft Elections from Secret Manager configuration
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/gte-launch
Restart=on-failure
RestartSec=60
[Install]
WantedBy=multi-user.target
SERVICE
systemctl daemon-reload
systemctl enable gte-launch.service
# The initial foundation intentionally has no credentials/configuration yet.
# systemd retries without making an insecure preview publicly accessible.
systemctl start --no-block gte-launch.service
