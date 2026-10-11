#!/usr/bin/env python3
"""Release an immutable image under a generation-guarded deployment lock.

No production secrets are read by the builder. Failed/cancelled mutations leave
an operator-visible lock; never guess that a timed-out rollout is finished.
"""
import argparse
import base64
import copy
import json
from pathlib import Path
import re
import shlex
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request


def validate_image(image, project, region):
    prefix = f'{region}-docker.pkg.dev/{project}/gte/app@sha256:'
    if not image.startswith(prefix) or not re.fullmatch(r'[a-f0-9]{64}', image[len(prefix):]):
        raise ValueError('image must be an immutable digest in this project registry')


def healthy_body(body):
    try:
        return json.loads(body).get('status') == 'ok'
    except (ValueError, AttributeError):
        return False


def fleet_ready(instances, template):
    return bool(instances) and all(
        vm.get('instanceStatus') == 'RUNNING'
        and vm.get('currentAction') == 'NONE'
        and vm.get('version', {}).get('instanceTemplate', '').endswith('/' + template)
        and bool(vm.get('instanceHealth'))
        and all(h.get('detailedHealthState') == 'HEALTHY' for h in vm['instanceHealth'])
        for vm in instances
    )


class Cloud:
    def __init__(self, project):
        self.project = project
        self.token = ''
        self.token_time = 0

    def request(self, url, method='GET', body=None, raw=False):
        if time.monotonic() - self.token_time > 3000 or not self.token:
            self.token = subprocess.check_output(
                ['gcloud', 'auth', 'print-access-token'], text=True, timeout=60).strip()
            self.token_time = time.monotonic()
        data = None if body is None else (body if raw else json.dumps(body).encode())
        request = urllib.request.Request(url, data=data, method=method, headers={
            'Authorization': 'Bearer ' + self.token,
            'Content-Type': 'application/json',
        })
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = response.read()
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as error:
            # These Compute/Storage/Build API errors contain resource/permission
            # diagnostics. Preserve the HTTP status for lock conflict handling.
            try:
                detail = json.loads(error.read(8192)).get('error', {}).get('message')
                if isinstance(detail, str):
                    error.msg = str(error.reason) + ': ' + detail[:1000]
            except (ValueError, AttributeError):
                pass
            raise

    def compute(self, path, method='GET', body=None):
        return self.request(f'https://compute.googleapis.com/compute/v1/projects/{self.project}/{path}', method, body)

    def operation(self, operation, deadline):
        while operation.get('status') != 'DONE':
            if time.monotonic() >= deadline:
                raise TimeoutError('Compute operation timed out; deployment remains locked')
            time.sleep(5)
            operation = self.request(operation['selfLink'])
        if operation.get('error'):
            raise RuntimeError(json.dumps(operation['error']))

    def write(self, name, body, generation=None):
        query = {'uploadType': 'media', 'name': name}
        if generation is not None:
            query['ifGenerationMatch'] = str(generation)
        return self.request(
            f'https://storage.googleapis.com/upload/storage/v1/b/{self.project}-gte-builds/o?'
            + urllib.parse.urlencode(query), 'POST', body)

    def unlock(self, generation):
        name = urllib.parse.quote('deploy/lock.json', safe='')
        return self.request(f'https://storage.googleapis.com/storage/v1/b/{self.project}-gte-builds/o/{name}?ifGenerationMatch={generation}', 'DELETE')


def acquire_lock(cloud, owner, deadline):
    while True:
        try:
            return cloud.write('deploy/lock.json', owner, generation=0)['generation']
        except urllib.error.HTTPError as error:
            if error.code != 412:
                raise
            if time.monotonic() >= deadline:
                raise TimeoutError('Deployment lock occupied; inspect its owning build before clearing it')
            time.sleep(10)


def current_master():
    # Public repository: do not borrow or persist a personal GitHub token.
    output = subprocess.check_output(
        ['git', 'ls-remote', 'https://github.com/xdadwal/gte-vi.git', 'refs/heads/master'],
        text=True, timeout=60)
    commit = output.split()[0]
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise RuntimeError('Unable to verify master HEAD')
    return commit


def ssh(project, region, command):
    subprocess.run(['gcloud', 'compute', 'ssh', 'gte-worker', f'--zone={region}-a',
                    f'--project={project}', '--tunnel-through-iap', '--quiet',
                    '--ssh-key-expire-after=30m', '--command=' + command],
                   check=True, timeout=600)


def verify_public(origin):
    # Only read public resources; no real report/refuge or admin fixture writes.
    def get(path):
        with urllib.request.urlopen(origin + path, timeout=30) as response:
            if response.status != 200:
                raise RuntimeError('Unexpected public response status')
            return response.read()
    if not healthy_body(get('/api/v1/health')):
        raise RuntimeError('Public health response is not healthy')
    if b'<html' not in get('/').lower():
        raise RuntimeError('Frontend shell missing')
    json.loads(get('/api/v1/snapshot?cells=2800:12600'))
    with urllib.request.urlopen(origin + '/api/v1/events?cells=2800:12600', timeout=30) as response:
        if response.headers.get_content_type() != 'text/event-stream':
            raise RuntimeError('SSE content type is incorrect')
        if response.readline(4096).strip() != b'event: snapshot':
            raise RuntimeError('SSE initial snapshot missing')
        data = response.readline(65536)
        if not data.startswith(b'data: ') or not isinstance(json.loads(data[6:]), dict):
            raise RuntimeError('SSE snapshot data missing')
    manifest = json.loads(get('/api/v1/routing/manifest.json'))
    # Validate routing response against its actual published tile URLs.
    tiles = manifest.get('tiles', {})
    if not tiles:
        raise RuntimeError('Walking manifest has no tiles')
    first = next(iter(tiles.values()))
    if not isinstance(first, str) or not re.fullmatch(r'[a-f0-9]+/[-0-9]+_[-0-9]+\.json', first):
        raise RuntimeError('Unexpected routing tile URL')
    json.loads(get('/api/v1/routing/' + first))


def deploy(args, cloud):
    deadline = time.monotonic() + 1500
    group_path = f'regions/{args.region}/instanceGroupManagers/gte-web'
    group = cloud.compute(group_path)
    templates = {v['instanceTemplate'] for v in group.get('versions', [])}
    if not templates:
        templates = {group['instanceTemplate']}
    if len(templates) != 1:
        raise RuntimeError('Existing multi-version rollout requires operator review')
    old_template = next(iter(templates)).rsplit('/', 1)[-1]
    original = cloud.compute('global/instanceTemplates/' + old_template)
    worker_path = f'zones/{args.region}-a/instances/gte-worker'
    worker = cloud.compute(worker_path)
    metadata = copy.deepcopy(worker['metadata'])
    old_image = next(v['value'] for v in metadata['items'] if v['key'] == 'gte-image')
    startup = Path(__file__).with_name('bootstrap.sh').read_text()
    launcher = re.search(r"<<'LAUNCH'\n(.*?)\nLAUNCH\n", startup, re.S)
    if not launcher or not launcher.group(1).startswith('#!/bin/bash'):
        raise RuntimeError('Unable to extract versioned worker launcher')
    template = 'gte-release-' + args.build_id[:36]
    record = {'buildId': args.build_id, 'commit': args.commit, 'image': args.image,
              'previousTemplate': old_template, 'previousWorkerImage': old_image,
              'template': template, 'status': 'deploying'}
    cloud.write(f'deploy/releases/{args.build_id}.json', record, generation=0)
    properties = copy.deepcopy(original['properties'])
    items = properties['metadata']['items']
    for key, value in [('gte-image', args.image), ('startup-script', startup)]:
        items[:] = [v for v in items if v['key'] != key] + [{'key': key, 'value': value}]
    properties['metadata'].pop('fingerprint', None)
    cloud.operation(cloud.compute('global/instanceTemplates', 'POST',
                                 {'name': template, 'properties': properties}), deadline)
    # Health-aware updates without dependency-driven destructive autohealing.
    cloud.operation(cloud.compute(group_path, 'PATCH', {
        'autoHealingPolicies': [{'healthCheck': f'https://www.googleapis.com/compute/v1/projects/{args.project}/global/healthChecks/gte-web',
                                 'initialDelaySec': 600}],
        'instanceLifecyclePolicy': {'onFailedHealthCheck': 'DO_NOTHING'},
    }), deadline)
    for key, value in [('gte-image', args.image), ('startup-script', startup)]:
        metadata['items'][:] = [v for v in metadata['items'] if v['key'] != key] + [{'key': key, 'value': value}]
    cloud.operation(cloud.compute(worker_path + '/setMetadata', 'POST', metadata), deadline)
    encoded = base64.b64encode(launcher.group(1).encode()).decode()
    command = "printf %s " + shlex.quote(encoded) + " | base64 -d | sudo tee /usr/local/bin/gte-launch >/dev/null; "
    command += 'sudo chmod 700 /usr/local/bin/gte-launch && sudo systemctl restart gte-launch.service && '
    command += "for attempt in $(seq 1 60); do if curl --fail --silent http://127.0.0.1:8081/api/v1/health | grep -q '\"status\":\"ok\"'; then exit 0; fi; sleep 2; done; exit 1"
    ssh(args.project, args.region, 'set -e; ' + command)
    # Regional groups need at least one surge slot per configured zone.
    surge = len(group.get('distributionPolicy', {}).get('zones', [])) or 3
    cloud.operation(cloud.compute(group_path, 'PATCH', {
        'versions': [{'instanceTemplate': f'projects/{args.project}/global/instanceTemplates/{template}'}],
        'updatePolicy': {'type': 'PROACTIVE', 'minimalAction': 'REPLACE',
                         'replacementMethod': 'SUBSTITUTE',
                         'maxSurge': {'fixed': surge}, 'maxUnavailable': {'fixed': 0}},
    }), deadline)
    while True:
        result = cloud.compute(group_path + '/listManagedInstances', 'POST', {})
        group_now = cloud.compute(group_path)
        if (not result.get('nextPageToken') and fleet_ready(result.get('managedInstances', []), template)
                and group_now.get('status', {}).get('versionTarget', {}).get('isReached')
                and group_now.get('status', {}).get('isStable')):
            break
        if time.monotonic() >= deadline:
            raise TimeoutError('Rollout not healthy/stable; inspect the retained deployment lock')
        print('Waiting for the new fleet to be healthy and stable...', flush=True)
        time.sleep(15)
    verify_public(args.origin)
    record['status'] = 'healthy'
    cloud.write(f'deploy/releases/{args.build_id}.json', record)
    cloud.write('deploy/current.json', record)
    print('Release verified: ' + args.commit, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    parser.add_argument('--region', default='asia-south2')
    parser.add_argument('--image', required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--build-id', required=True)
    parser.add_argument('--origin', default='https://grandtheftelections.in')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    validate_image(args.image, args.project, args.region)
    if not re.fullmatch(r'[a-f0-9]{40}', args.commit) or not re.fullmatch(r'[a-z0-9-]{1,50}', args.build_id):
        parser.error('Expected a full commit SHA and a safe unique build ID')
    origin = urllib.parse.urlparse(args.origin)
    if origin.scheme != 'https' or not origin.hostname or origin.path or origin.query or origin.fragment or origin.username:
        parser.error('origin must be an HTTPS origin without a path or credentials')
    cloud = Cloud(args.project)
    if args.dry_run:
        cloud.compute(f'regions/{args.region}/instanceGroupManagers/gte-web')
        cloud.compute(f'zones/{args.region}-a/instances/gte-worker')
        print('Read-only deployment preflight passed; no resources changed.')
        return
    generation = acquire_lock(cloud, {'buildId': args.build_id, 'commit': args.commit}, time.monotonic() + 900)
    mutated = False
    try:
        if current_master() != args.commit:
            print('Commit superseded on master; skipping production deployment.')
            return
        mutated = True
        deploy(args, cloud)
        mutated = False
    finally:
        if not mutated:
            cloud.unlock(generation)
        else:
            print('Deployment failed after starting; lock retained for operator review.', flush=True)


if __name__ == '__main__':
    main()
