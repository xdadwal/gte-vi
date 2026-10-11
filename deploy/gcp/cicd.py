#!/usr/bin/env python3
"""Configure a master-only Cloud Build trigger for the existing GTE deployment.

Run foundation provisioning first. GitHub App installation is interactive once;
its connection credential is managed by Cloud Build, never copied from gh.
"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import urllib.parse

PERMISSIONS = [
    'compute.instanceTemplates.create', 'compute.instanceTemplates.get', 'compute.instanceTemplates.list',
    'compute.instanceTemplates.useReadOnly',
    'compute.instanceGroupManagers.get', 'compute.instanceGroupManagers.update',
    'compute.instances.get', 'compute.instances.list', 'compute.instances.setMetadata',
    'compute.projects.get', 'compute.zones.get', 'compute.zones.list',
    'compute.regionOperations.get', 'compute.globalOperations.get', 'compute.zoneOperations.get',
    'compute.subnetworks.use', 'compute.subnetworks.get',
    'compute.networks.use', 'compute.networks.get',
    'compute.healthChecks.get', 'compute.healthChecks.useReadOnly',
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    parser.add_argument('--region', default='asia-south2')
    parser.add_argument('--origin', default='https://grandtheftelections.in')
    args = parser.parse_args()
    project, region = args.project, args.region
    origin = urllib.parse.urlparse(args.origin)
    if (origin.scheme != 'https' or not origin.hostname or origin.path
            or origin.query or origin.fragment or origin.username):
        parser.error('origin must be an HTTPS origin without a path or credentials')

    def run(command, check=True):
        result = subprocess.run(['gcloud', *command, '--project=' + project, '--quiet'],
                                capture_output=True, text=True, timeout=300)
        if check and result.returncode:
            raise RuntimeError(result.stderr)
        return result

    def missing(result):
        if result.returncode == 0:
            return False
        if not any(s in result.stderr for s in ('NOT_FOUND', 'not found', 'does not exist', 'Not Found', 'notFound')):
            raise RuntimeError(result.stderr)
        return True

    role = {'title': 'GTE deployment automation', 'description': 'Template rollout and worker metadata; no Secret Manager access',
            'stage': 'GA', 'includedPermissions': PERMISSIONS}
    with tempfile.TemporaryDirectory() as directory:
        filename = Path(directory) / 'role.json'
        filename.write_text(json.dumps(role))
        action = 'create' if missing(run(['iam', 'roles', 'describe', 'gteDeployment'], check=False)) else 'update'
        run(['iam', 'roles', action, 'gteDeployment', '--file=' + str(filename)])
    builder = 'gte-build@' + project + '.iam.gserviceaccount.com'
    member = '--member=serviceAccount:' + builder
    for role_name in ['projects/' + project + '/roles/gteDeployment', 'roles/compute.osAdminLogin',
                      'roles/iap.tunnelResourceAccessor', 'roles/logging.logWriter']:
        run(['projects', 'add-iam-policy-binding', project, member, '--role=' + role_name, '--condition=None'])
    run(['iam', 'service-accounts', 'add-iam-policy-binding',
         'gte-runtime@' + project + '.iam.gserviceaccount.com', member, '--role=roles/iam.serviceAccountUser'])
    connection = run(['builds', 'connections', 'describe', 'gte-github', '--region=' + region, '--format=json'], check=False)
    agent = 'service-' + json.loads(run(['projects', 'describe', project, '--format=json']).stdout)['projectNumber'] + '@gcp-sa-cloudbuild.iam.gserviceaccount.com'
    if missing(connection):
        # Required only for the installation handshake. Remove on completion.
        run(['projects', 'add-iam-policy-binding', project, '--member=serviceAccount:' + agent,
             '--role=roles/secretmanager.admin', '--condition=None'])
        run(['builds', 'connections', 'create', 'github', 'gte-github', '--region=' + region])
        connection = run(['builds', 'connections', 'describe', 'gte-github', '--region=' + region, '--format=json'])
    state = json.loads(connection.stdout)['installationState']
    if state['stage'] != 'COMPLETE':
        print('Authorize the Cloud Build GitHub App, then rerun this command:')
        print(state.get('actionUri', 'See the connection in the Cloud Build console.'))
        return
    # Installation granted its own credential-secret binding; broad temporary
    # administration must not remain on the Cloud Build service agent.
    policy = json.loads(run(['projects', 'get-iam-policy', project, '--format=json']).stdout)
    if any(b['role'] == 'roles/secretmanager.admin' and 'serviceAccount:' + agent in b['members']
           and not b.get('condition') for b in policy.get('bindings', [])):
        run(['projects', 'remove-iam-policy-binding', project, '--member=serviceAccount:' + agent,
             '--role=roles/secretmanager.admin', '--condition=None'])
    repo = run(['builds', 'repositories', 'describe', 'gte-vi', '--connection=gte-github',
                '--region=' + region, '--format=json'], check=False)
    if missing(repo):
        run(['builds', 'repositories', 'create', 'gte-vi', '--connection=gte-github', '--region=' + region,
             '--remote-uri=https://github.com/xdadwal/gte-vi.git'])
    repository = f'projects/{project}/locations/{region}/connections/gte-github/repositories/gte-vi'
    triggers = json.loads(run(['builds', 'triggers', 'list', '--region=' + region, '--format=json']).stdout)
    existing = next((t for t in triggers if t.get('name') == 'gte-master-deploy'), None)
    trigger = {
        'name': 'gte-master-deploy', 'description': 'Test, build and deploy master to Grand Theft Elections',
        'filename': 'cloudbuild.yaml', 'serviceAccount': f'projects/{project}/serviceAccounts/{builder}',
        'repositoryEventConfig': {'repository': repository, 'push': {'branch': '^master$'}},
        'substitutions': {'_REGION': region, '_ORIGIN': args.origin, '_DEPLOY': 'true'},
        'includeBuildLogs': 'INCLUDE_BUILD_LOGS_WITH_STATUS',
    }
    # Use the API for create/update: gcloud trigger-config and region flags are
    # mutually exclusive in some SDK versions. PATCH keeps the trigger ID.
    from release import Cloud
    cloud = Cloud(project)
    endpoint = f'https://cloudbuild.googleapis.com/v1/projects/{project}/locations/{region}/triggers'
    if existing:
        cloud.request(endpoint + '/' + existing['id'], 'PATCH', trigger)
    else:
        cloud.request(endpoint, 'POST', trigger)
    print('Master-only trigger configured. cloudbuild.yaml must be merged before its first master build.')


if __name__ == '__main__':
    main()
