#!/bin/sh
# Local CA and TLS certificate for an explicitly chosen LAN IPv4 address.
set -eu
ip=${1:?Usage: scripts/dev-cert.sh LAN_IPV4}
case "$ip" in *[!0-9.]*|'') echo 'Expected a LAN IPv4 address' >&2; exit 1;; esac
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
dir="$repo/artifacts/tls"
umask 077
mkdir -p "$dir"
chmod 700 "$dir"
if [ ! -f "$dir/root.pem" ]; then
  cat > "$dir/root.conf" <<'CONF'
[req]
prompt = no
distinguished_name = dn
x509_extensions = ca
[dn]
CN = GTE Local Development CA
[ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
CONF
  openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 365 -config "$dir/root.conf" -keyout "$dir/root.key" -out "$dir/root.pem" 2>/dev/null
fi
openssl x509 -in "$dir/root.pem" -outform DER -out "$dir/root.cer"
openssl req -new -newkey rsa:2048 -nodes -sha256 -subj '/CN=GTE Local Preview' -keyout "$dir/server.key" -out "$dir/server.csr" 2>/dev/null
cat > "$dir/server.ext" <<CONF
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = IP:$ip,IP:127.0.0.1,DNS:localhost
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
CONF
openssl x509 -req -in "$dir/server.csr" -CA "$dir/root.pem" -CAkey "$dir/root.key" -CAcreateserial -days 30 -sha256 -extfile "$dir/server.ext" -out "$dir/server.pem" 2>/dev/null
openssl verify -CAfile "$dir/root.pem" "$dir/server.pem"
printf 'Preview certificate created for %s. Trust only root.cer on your test device. Private keys remain in artifacts/tls.\n' "$ip"
