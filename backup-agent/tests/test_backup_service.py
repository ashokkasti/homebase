import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import backup_service as b


def container(cid, service, image, source, target, running=True, settings=None):
    return {'Id': cid, 'Name': '/' + service, 'Image': 'sha256:' + cid,
            'Config': {'Image': image, 'Env': [f'{k}={v}' for k, v in (settings or {}).items()],
                       'Labels': {'com.docker.compose.project': 'test', 'com.docker.compose.service': service}},
            'State': {'Running': running, 'ExitCode': 0},
            'Mounts': [{'Type': 'bind', 'Source': str(source), 'Destination': target, 'RW': True}],
            'NetworkSettings': {'Networks': {'test': {'Aliases': [service]}}}}


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db = self.root / 'pgdata'
        self.db.mkdir()
        (self.db / 'PG_VERSION').write_text('15\n')
        self.objects = self.root / 'objects'
        self.objects.mkdir()
        (self.objects / 'example.jpg').write_bytes(b'object-content')
        self.config = {'name': 'test', 'project': 'test', 'mount': str(self.root / 'disk'),
                       'disk_uuid': 'disk-uuid', 'state_dir': str(self.root / 'state'),
                       'password_file': str(self.root / 'password'), 'health_timeout_seconds': 0}
        Path(self.config['mount']).mkdir()
        Path(self.config['password_file']).write_text('test-password')
        os.chmod(self.config['password_file'], 0o600)
        self.service = b.Service(self.config)
        self.dbc = container('db', 'db', 'supabase/postgres:15', self.db, '/pg', settings={'PGDATA': '/pg'})
        self.stor = container('storage', 'storage', 'supabase/storage-api:v1', self.objects, '/data', settings={'STORAGE_BACKEND': 'file', 'FILE_STORAGE_BACKEND_PATH': '/data'})
        self.containers = [self.dbc, self.stor]

    def fake_mount(self, **changes):
        d = {'target': self.config['mount'], 'uuid': 'disk-uuid', 'fstype': 'ext4', 'options': 'rw,nodev'}
        d.update(changes)
        return json.dumps({'filesystems': [d]})

    def test_wrong_uuid_refuses_root_fallback(self):
        with patch.object(b, 'run', return_value=self.fake_mount(uuid='root-uuid')):
            with self.assertRaisesRegex(RuntimeError, 'UUID mismatch'):
                self.service.disk()

    def test_missing_mount_refuses_parent_filesystem(self):
        with patch.object(b, 'run', return_value=self.fake_mount(target='/')):
            with self.assertRaisesRegex(RuntimeError, 'fallback'):
                self.service.disk()

    def test_readonly_disk_rejected(self):
        with patch.object(b, 'run', return_value=self.fake_mount(options='ro')):
            with self.assertRaisesRegex(RuntimeError, 'read-write'):
                self.service.disk()

    def test_repository_symlink_rejected(self):
        (Path(self.config['mount']) / 'restic').symlink_to(self.root / 'elsewhere')
        with patch.object(b, 'run', return_value=self.fake_mount()):
            with self.assertRaisesRegex(RuntimeError, 'Repository'):
                self.service.disk()

    def test_s3_captures_actual_rustfs_volume(self):
        storage = copy.deepcopy(self.stor)
        storage['Config']['Env'] = ['STORAGE_BACKEND=s3', 'GLOBAL_S3_ENDPOINT=http://rustfs:9000']
        provider = container('rust', 'rustfs', 'rustfs/rustfs:latest', self.root / 'rustdata', '/data')
        layout = b.discover(self.config, [self.dbc, storage, provider])
        self.assertIn(str(self.root / 'rustdata'), layout['sources'])
        self.assertEqual(layout['stop_order'][-1]['Id'], 'db')
        self.assertEqual(layout['stop_order'][-2]['Id'], 'rust')

    def test_external_s3_is_not_silently_omitted(self):
        self.stor['Config']['Env'] = ['STORAGE_BACKEND=s3', 'GLOBAL_S3_ENDPOINT=https://external.example']
        with self.assertRaisesRegex(RuntimeError, 'external S3'):
            b.discover(self.config, self.containers)

    def test_shared_live_writer_rejected(self):
        other = container('other', 'writer', 'other:v1', self.objects, '/data')
        other['Config']['Labels']['com.docker.compose.project'] = 'other'
        with self.assertRaisesRegex(RuntimeError, 'Unmanaged writer'):
            b.discover(self.config, self.containers + [other])

    def test_recover_starts_all_before_polling_health(self):
        b.atomic_json(self.service.journal, {'restart_order': [{'id': 'db', 'name': 'db'}, {'id': 'storage', 'name': 'storage'}]})
        running = set()
        def inspect(cid):
            return {'State': {'Running': cid in running, 'Health': {'Status': 'healthy' if len(running) == 2 else 'starting'}}}
        def command(args, **kw):
            if args[:2] == ['docker', 'start']:
                running.add(args[2])
            return ''
        with patch.object(self.service, 'inspect_id', side_effect=inspect), patch.object(b, 'run', side_effect=command):
            self.service.recover()
        self.assertEqual(running, {'db', 'storage'})
        self.assertFalse(self.service.journal.exists())

    def test_recovery_failure_keeps_durable_journal(self):
        b.atomic_json(self.service.journal, {'restart_order': [{'id': 'db', 'name': 'db'}]})
        with patch.object(self.service, 'inspect_id', side_effect=RuntimeError('missing container')):
            with self.assertRaisesRegex(RuntimeError, 'Recovery incomplete'):
                self.service.recover()
        self.assertTrue(self.service.journal.exists())

    def test_lock_excludes_concurrent_operations(self):
        other = b.Service(self.config)
        with self.service.lock():
            with self.assertRaisesRegex(RuntimeError, 'Another backup'):
                with other.lock():
                    pass

    def test_manifest_atomic_write_permissions(self):
        file = self.root / 'state.json'
        b.atomic_json(file, {'value': 1})
        b.atomic_json(file, {'value': 2})
        self.assertEqual(b.read_json(file), {'value': 2})
        self.assertEqual(file.stat().st_mode & 0o777, 0o600)

    def test_failure_during_backup_resumes_only_previously_running(self):
        stopped = container('stopped', 'stopped', 'other:v1', self.root / 'unused', '/data', running=False)
        self.containers.append(stopped)
        layout = b.discover(self.config, self.containers)
        commands = []
        def command(args, **kw):
            commands.append(args)
            if args[:3] == ['docker', 'image', 'inspect']:
                return '[{"RepoDigests": []}]'
            if args[:2] == ['docker', 'stop']:
                for c in self.containers:
                    if c['Id'] == args[-1]:
                        c['State']['Running'] = False
            if args[:2] == ['docker', 'start']:
                for c in self.containers:
                    if c['Id'] == args[-1]:
                        c['State']['Running'] = True
            return ''
        def inspect(cid):
            return next(c for c in self.containers if c['Id'] == cid)
        with patch.object(self.service, 'preflight', return_value=layout), patch.object(self.service, 'assert_cold'), \
             patch.object(self.service, 'inspect_id', side_effect=inspect), patch.object(b, 'run', side_effect=command), \
             patch.object(self.service, 'restic', side_effect=RuntimeError('restic failed (3)')):
            with self.assertRaisesRegex(RuntimeError, 'restic failed'):
                self.service.backup()
        self.assertTrue(self.dbc['State']['Running'])
        self.assertTrue(self.stor['State']['Running'])
        self.assertFalse(stopped['State']['Running'])
        self.assertFalse(self.service.journal.exists())
        self.assertNotIn('complete', [str(arg) for cmd in commands for arg in cmd])

    def test_changed_deployment_aborts_capture(self):
        layout = b.discover(self.config, self.containers)
        changed = copy.deepcopy(self.containers)
        changed[0]['Id'] = 'replacement'
        with patch.object(b, 'inspect_all', return_value=changed):
            with self.assertRaisesRegex(RuntimeError, 'deployment changed'):
                self.service.assert_cold(layout)

    def test_retention_is_gated_before_deleting_history(self):
        snapshot = {'id': 'a', 'time': b.now().isoformat()}
        with patch.object(self.service, 'disk'), patch.object(self.service, 'snapshots', return_value=[snapshot]), \
             patch.object(self.service, 'restic') as restic:
            with self.assertRaisesRegex(RuntimeError, 'verified database/file restore'):
                self.service.maintenance()
        self.assertEqual(restic.call_args_list[0].args, ('check',))
        self.assertEqual(restic.call_count, 1)

    def test_failed_last_attempt_is_unhealthy_even_with_recent_backup(self):
        self.service.status(state='failed', last_success=b.now().isoformat())
        with patch.object(self.service, 'disk'):
            with self.assertRaisesRegex(RuntimeError, 'attempt failed'):
                self.service.health()

    def test_recovery_unpauses_controller_without_restarting(self):
        b.atomic_json(self.service.journal, {'restart_order': [{'id': 'controller', 'name': 'coolify', 'mode': 'freeze'}]})
        state = {'Running': True, 'Paused': True}
        commands = []
        def command(args, **kwargs):
            commands.append(args)
            if args[:2] == ['docker', 'unpause']:
                state['Paused'] = False
            return ''
        with patch.object(self.service, 'inspect_id', side_effect=lambda cid: {'State': dict(state)}), \
             patch.object(b, 'run', side_effect=command):
            self.service.recover()
        self.assertEqual(commands, [['docker', 'unpause', 'controller']])
        self.assertFalse(self.service.journal.exists())

    def test_database_cannot_use_controller_freeze_mode(self):
        self.config['quiesce_containers'] = ['db']
        self.config['freeze_containers'] = ['db']
        with self.assertRaisesRegex(RuntimeError, 'Only external controllers'):
            b.discover(self.config, self.containers)

    def test_capture_requires_frozen_controller_and_stopped_data_engines(self):
        self.config['quiesce_containers'] = ['coolify']
        self.config['freeze_containers'] = ['coolify']
        controller = container('controller', 'coolify', 'coolify:v1', self.objects, '/config')
        controller['Config']['Labels']['com.docker.compose.project'] = 'controller'
        all_containers = self.containers + [controller]
        layout = b.discover(self.config, all_containers)
        self.dbc['State']['Running'] = False
        self.stor['State']['Running'] = False
        controller['State']['Paused'] = True
        with patch.object(b, 'inspect_all', return_value=all_containers), patch.object(self.service, 'disk'):
            self.service.assert_cold(layout)
            controller['State']['Paused'] = False
            with self.assertRaisesRegex(RuntimeError, 'unfroze'):
                self.service.assert_cold(layout)

    def test_analytics_and_api_pause_but_postgres_and_rustfs_stop(self):
        self.stor['Config']['Env'] = ['STORAGE_BACKEND=s3', 'GLOBAL_S3_ENDPOINT=http://rustfs:9000']
        provider = container('rust', 'rustfs', 'rustfs/rustfs:latest', self.root / 'rustdata', '/data')
        analytics = container('analytics', 'analytics', 'supabase/logflare:1.31.2', self.root / 'logs', '/logs')
        analytics['Mounts'] = []
        layout = b.discover(self.config, self.containers + [provider, analytics])
        self.assertEqual(layout['lifecycle']['db'], 'stop')
        self.assertEqual(layout['lifecycle']['rust'], 'stop')
        self.assertEqual(layout['lifecycle']['storage'], 'pause')
        self.assertEqual(layout['lifecycle']['analytics'], 'pause')

    def test_file_backed_storage_requires_clean_shutdown(self):
        layout = b.discover(self.config, self.containers)
        self.assertEqual(layout['lifecycle']['storage'], 'stop')

    def test_unknown_stateful_addon_is_not_silently_paused(self):
        addon = container('addon', 'addon', 'custom/database:latest', self.root / 'addon', '/data')
        layout = b.discover(self.config, self.containers + [addon])
        self.assertEqual(layout['lifecycle']['addon'], 'stop')


@unittest.skipUnless(os.environ.get('RESTIC_TEST_BIN'), 'Set RESTIC_TEST_BIN for real Restic integration')
class ResticIntegrationTests(unittest.TestCase):
    setUp = ServiceTests.setUp
    def test_real_backup_tag_and_restore_bytes(self):
        binary = os.environ['RESTIC_TEST_BIN']
        real_run = b.run
        def run(args, **kwargs):
            if args[0] == 'restic':
                args = [binary, *args[1:]]
            return real_run(args, **kwargs)
        with patch.object(b, 'run', side_effect=run), patch.object(self.service, 'disk'):
            self.service.init()
            result = self.service.restic('backup', '--json', '--host', 'test', '--tag', 'test', '--tag', 'pending',
                                         '--', str(self.db), str(self.objects))
            summary = [json.loads(line) for line in result.splitlines() if json.loads(line).get('message_type') == 'summary'][0]
            self.service.restic('tag', '--remove', 'pending', '--add', 'complete', summary['snapshot_id'])
            snapshots = self.service.snapshots()
            self.assertEqual(len(snapshots), 1)
            self.assertNotIn('pending', snapshots[0]['tags'])
            target = self.root / 'restored'
            self.service.restic('restore', '--verify', '--target', str(target), snapshots[0]['id'])
            self.assertEqual((target / str(self.objects).lstrip('/') / 'example.jpg').read_bytes(), b'object-content')
            self.assertEqual((target / str(self.db).lstrip('/') / 'PG_VERSION').read_text(), '15\n')
            self.service.restic('check', '--read-data')

class FormattingSafetyTests(unittest.TestCase):
    def test_same_partition_cannot_be_erased_and_preserved(self):
        import argparse
        import setup as installer
        with tempfile.TemporaryDirectory() as directory:
            args = argparse.Namespace(erase_uuid='mac', preserve_uuid='photos', mount='/srv/backups')
            device = {'type': 'part', 'pkname': 'sdb'}
            with patch.object(installer, 'ETC', Path(directory)), \
                 patch.object(installer, 'resolve_uuid', return_value='/dev/sdb1'), \
                 patch.object(installer, 'block_info', return_value=device), patch.object(installer, 'run') as command:
                with self.assertRaisesRegex(RuntimeError, 'distinct partitions'):
                    installer.prepare_disk(args)
                command.assert_not_called()

    def test_existing_unrelated_mount_blocks_format(self):
        import argparse
        import setup as installer
        with tempfile.TemporaryDirectory() as directory:
            args = argparse.Namespace(erase_uuid='mac', preserve_uuid='photos', mount='/srv/backups')
            mac = {'type': 'part', 'pkname': 'sdb', 'fstype': 'hfsplus', 'partuuid': 'partition1',
                   'uuid': 'mac', 'mountpoints': ['/mnt/mac'], 'size': 500000000000}
            photos = {'type': 'part', 'pkname': 'sdb'}
            with patch.object(installer, 'ETC', Path(directory)), \
                 patch.object(installer, 'resolve_uuid', side_effect=['/dev/sdb1', '/dev/sdb2']), \
                 patch.object(installer, 'block_info', side_effect=[mac, photos]), \
                 patch.object(installer.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'other-disk\n')), \
                 patch.object(installer, 'run') as command:
                with self.assertRaisesRegex(RuntimeError, 'another filesystem'):
                    installer.prepare_disk(args)
                command.assert_not_called()

    def test_system_partition_blocks_format(self):
        import argparse
        import setup as installer
        with tempfile.TemporaryDirectory() as directory:
            args = argparse.Namespace(erase_uuid='root', preserve_uuid='boot', mount='/srv/backups')
            root = {'type': 'part', 'pkname': 'sda', 'fstype': 'ext4', 'mountpoints': ['/']}
            other = {'type': 'part', 'pkname': 'sda'}
            with patch.object(installer, 'ETC', Path(directory)), \
                 patch.object(installer, 'resolve_uuid', side_effect=['/dev/sda1', '/dev/sda2']), \
                 patch.object(installer, 'block_info', side_effect=[root, other]), patch.object(installer, 'run') as command:
                with self.assertRaisesRegex(RuntimeError, 'system partition'):
                    installer.prepare_disk(args)
                command.assert_not_called()


if __name__ == '__main__':
    unittest.main()
