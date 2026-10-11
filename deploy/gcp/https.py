#!/usr/bin/env python3
"""Prepare HTTPS and HTTP-to-HTTPS redirect for an existing GTE backend.

DNS must point the domain to the reserved gte-web IP before the managed
certificate can activate. This script does not change registrar DNS.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    parser.add_argument('--domain', required=True)
    args = parser.parse_args()
    domain = args.domain.lower().rstrip('.')
    if len(domain) > 253 or not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', domain):
        parser.error('domain must be a plain DNS hostname')

    def run(command, check=True):
        result = subprocess.run(['gcloud', *command, '--project=' + args.project, '--quiet', '--format=json'], capture_output=True, text=True)
        if check and result.returncode:
            raise RuntimeError(result.stderr)
        return result

    def ensure(describe, create):
        result = run(describe, check=False)
        if result.returncode:
            if not any(x in result.stderr for x in ('NOT_FOUND', 'not found', 'does not exist', 'Not Found', 'notFound')):
                raise RuntimeError(result.stderr)
            run(create)
            result = run(describe)
        return json.loads(result.stdout)

    cert = ensure(['compute', 'ssl-certificates', 'describe', 'gte-web', '--global'],
                  ['compute', 'ssl-certificates', 'create', 'gte-web', '--global', '--domains=' + domain])
    if cert.get('managed', {}).get('domains') != [domain]:
        raise SystemExit('Existing certificate covers another domain; use an explicit certificate migration')
    ensure(['compute', 'ssl-policies', 'describe', 'gte-web'],
           ['compute', 'ssl-policies', 'create', 'gte-web', '--profile=MODERN', '--min-tls-version=1.2'])
    ensure(['compute', 'target-https-proxies', 'describe', 'gte-web', '--global'],
           ['compute', 'target-https-proxies', 'create', 'gte-web', '--global', '--url-map=gte-web', '--ssl-certificates=gte-web', '--ssl-policy=gte-web'])
    ensure(['compute', 'forwarding-rules', 'describe', 'gte-web-https', '--global'],
           ['compute', 'forwarding-rules', 'create', 'gte-web-https', '--global', '--load-balancing-scheme=EXTERNAL_MANAGED', '--address=gte-web', '--target-https-proxy=gte-web', '--ports=443', '--network-tier=PREMIUM'])
    redirect = {'name': 'gte-web-redirect', 'defaultUrlRedirect': {'hostRedirect': domain, 'httpsRedirect': True, 'redirectResponseCode': 'MOVED_PERMANENTLY_DEFAULT', 'stripQuery': False}}
    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory) / 'redirect.json'
        source.write_text(json.dumps(redirect))
        current = ensure(['compute', 'url-maps', 'describe', 'gte-web-redirect'],
                         ['compute', 'url-maps', 'import', 'gte-web-redirect', '--global', '--source=' + str(source)])
        actual = current.get('defaultUrlRedirect', {})
        if any(actual.get(k, False if k == 'stripQuery' else None) != v for k, v in redirect['defaultUrlRedirect'].items()):
            raise SystemExit('Existing redirect differs; review it before changing the domain')
    ensure(['compute', 'target-http-proxies', 'describe', 'gte-web-redirect', '--global'],
           ['compute', 'target-http-proxies', 'create', 'gte-web-redirect', '--global', '--url-map=gte-web-redirect'])
    ensure(['compute', 'forwarding-rules', 'describe', 'gte-web-http', '--global'],
           ['compute', 'forwarding-rules', 'create', 'gte-web-http', '--global', '--load-balancing-scheme=EXTERNAL_MANAGED', '--address=gte-web', '--target-http-proxy=gte-web-redirect', '--ports=80', '--network-tier=PREMIUM'])
    address = json.loads(run(['compute', 'addresses', 'describe', 'gte-web', '--global']).stdout)
    print('HTTPS endpoint prepared. Set the domain A record to ' + address['address'] + '; certificate activation requires matching DNS.')


if __name__ == '__main__':
    main()
