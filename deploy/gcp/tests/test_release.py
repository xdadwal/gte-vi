"""Guard deployment decisions: no unsafe input or premature success."""
import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).parents[1] / 'release.py'
spec = importlib.util.spec_from_file_location('release', path)
release = importlib.util.module_from_spec(spec)
if path.exists():
    spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def test_mutable_or_foreign_images_never_deploy(self):
        validate = getattr(release, 'validate_image', None)
        self.assertIsNotNone(validate, 'immutable image validation is not implemented')
        for image in ['asia-south2-docker.pkg.dev/demo/gte/app:latest',
                      'other.example/demo/app@sha256:' + 'a' * 64]:
            with self.assertRaises(ValueError):
                validate(image, 'demo', 'asia-south2')
        validate('asia-south2-docker.pkg.dev/demo/gte/app@sha256:' + 'a' * 64,
                 'demo', 'asia-south2')

    def test_running_vm_with_old_template_is_not_a_completed_rollout(self):
        ready = getattr(release, 'fleet_ready', None)
        self.assertIsNotNone(ready, 'rollout readiness is not implemented')
        vm = {'instanceStatus': 'RUNNING', 'currentAction': 'NONE',
              'version': {'instanceTemplate': 'projects/demo/global/instanceTemplates/new'},
              'instanceHealth': [{'detailedHealthState': 'HEALTHY'}]}
        self.assertTrue(ready([vm], 'new'))
        for field, value in [('instanceStatus', 'STAGING'), ('currentAction', 'RECREATING'),
                             ('version', {'instanceTemplate': 'projects/demo/global/instanceTemplates/old'}),
                             ('instanceHealth', [{'detailedHealthState': 'UNHEALTHY'}]),
                             ('instanceHealth', [])]:
            self.assertFalse(ready([{**vm, field: value}], 'new'), field)
        self.assertFalse(ready([], 'new'))

    def test_health_body_must_be_healthy_even_when_http_succeeds(self):
        healthy = getattr(release, 'healthy_body', None)
        self.assertIsNotNone(healthy, 'health response validation is not implemented')
        self.assertTrue(healthy(b'{"status":"ok"}'))
        for body in [b'{"status":"stale"}', b'<html>Bad Gateway</html>', b'{}']:
            self.assertFalse(healthy(body))

class PublicVerificationTests(unittest.TestCase):
    def test_reads_versioned_graph_tile_and_live_snapshot(self):
        import http.server
        import threading
        seen = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                seen.append(self.path)
                responses = {
                    '/': b'<html><body>Map</body></html>',
                    '/api/v1/health': b'{"status":"ok"}',
                    '/api/v1/routing/manifest.json': b'{"tiles":{"2800:12600":"abc/2800_12600.json"}}',
                    '/api/v1/routing/abc/2800_12600.json': b'{"nodes":[],"edges":[]}',
                    '/api/v1/snapshot?cells=2800:12600': b'{"incidents":[]}',
                    '/api/v1/events?cells=2800:12600': b'event: snapshot\ndata: {"incidents":[]}\n\n',
                }
                body = responses.get(self.path)
                self.send_response(200 if body else 404)
                self.send_header('Content-Type', 'text/event-stream' if '/events?' in self.path else 'application/json')
                self.end_headers()
                self.wfile.write(body or b'not found')

            def log_message(self, *args):
                pass

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            release.verify_public(f'http://127.0.0.1:{server.server_port}')
            self.assertIn('/api/v1/routing/abc/2800_12600.json', seen)
            self.assertIn('/api/v1/events?cells=2800:12600', seen)
            self.assertIn('/api/v1/snapshot?cells=2800:12600', seen)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

class RolloutOrderingTests(unittest.TestCase):
    def run_release(self, worker_error=False, superseded=False):
        import copy
        import sys
        from unittest.mock import patch
        cloud = type('CloudFixture', (), {})()
        cloud.objects = {}
        cloud.group = {'instanceTemplate': 'projects/demo/global/instanceTemplates/old',
                       'versions': [{'instanceTemplate': 'projects/demo/global/instanceTemplates/old'}],
                       'distributionPolicy': {'zones': [{}, {}, {}]},
                       'status': {'isStable': True, 'versionTarget': {'isReached': True}}}
        cloud.worker = {'metadata': {'fingerprint': 'initial', 'items': [{'key': 'gte-image', 'value': 'old-image'}]}}

        def write(name, body, generation=None):
            if generation == 0 and name in cloud.objects:
                raise AssertionError('duplicate object creation')
            cloud.objects[name] = copy.deepcopy(body)
            return {'generation': '123'}

        def compute(path, method='GET', body=None):
            if path.endswith('/listManagedInstances'):
                template = cloud.group['versions'][0]['instanceTemplate']
                return {'managedInstances': [{'instanceStatus': 'RUNNING', 'currentAction': 'NONE',
                                              'version': {'instanceTemplate': template},
                                              'instanceHealth': [{'detailedHealthState': 'HEALTHY'}]}]}
            if path == 'global/instanceTemplates/old':
                return {'properties': {'metadata': {'items': [{'key': 'gte-image', 'value': 'old-image'}]}}}
            if path == 'global/instanceTemplates':
                cloud.created_template = copy.deepcopy(body)
            elif path.endswith('/setMetadata'):
                cloud.worker['metadata'] = copy.deepcopy(body)
            elif path.endswith('/instances/gte-worker'):
                return copy.deepcopy(cloud.worker)
            elif method == 'PATCH':
                cloud.group.update(copy.deepcopy(body))
            else:
                return copy.deepcopy(cloud.group)
            return {'status': 'DONE'}

        cloud.write = write
        cloud.compute = compute
        cloud.operation = lambda operation, deadline: None
        cloud.unlock = lambda generation: cloud.objects.pop('deploy/lock.json')
        args = ['release.py', '--project=demo', '--region=asia-south2',
                '--image=asia-south2-docker.pkg.dev/demo/gte/app@sha256:' + 'a' * 64,
                '--commit=' + 'b' * 40, '--build-id=ordering-test']
        with patch.object(sys, 'argv', args), patch.object(release, 'Cloud', return_value=cloud), \
                patch.object(release, 'current_master', return_value=('c' if superseded else 'b') * 40), \
                patch.object(release, 'ssh', side_effect=RuntimeError('worker failed') if worker_error else None), \
                patch.object(release, 'verify_public'):
            if worker_error:
                with self.assertRaisesRegex(RuntimeError, 'worker failed'):
                    release.main()
            else:
                release.main()
        return cloud

    def test_worker_failure_keeps_old_web_version_and_retains_lock(self):
        cloud = self.run_release(worker_error=True)
        self.assertEqual(cloud.group['versions'][0]['instanceTemplate'], 'projects/demo/global/instanceTemplates/old')
        self.assertEqual(cloud.objects['deploy/lock.json']['buildId'], 'ordering-test')
        self.assertNotIn('deploy/current.json', cloud.objects)

    def test_superseded_commit_never_mutates_fleet_and_releases_lock(self):
        cloud = self.run_release(superseded=True)
        self.assertEqual(cloud.objects, {})
        self.assertEqual(cloud.worker['metadata']['items'][0]['value'], 'old-image')
        self.assertEqual(cloud.group['versions'][0]['instanceTemplate'], 'projects/demo/global/instanceTemplates/old')

    def test_verified_rollout_records_current_release_and_releases_lock(self):
        cloud = self.run_release()
        self.assertNotIn('deploy/lock.json', cloud.objects)
        self.assertEqual(cloud.objects['deploy/current.json']['status'], 'healthy')
        self.assertEqual(cloud.objects['deploy/current.json']['previousWorkerImage'], 'old-image')
        self.assertTrue(cloud.group['versions'][0]['instanceTemplate'].endswith('/gte-release-ordering-test'))


if __name__ == '__main__':
    unittest.main()
