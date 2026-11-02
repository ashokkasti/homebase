import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import backup_service as b
import control
import destination as d


class DestinationValidationTests(unittest.TestCase):
    def test_rejects_unmounted_wrong_type_readonly_and_root(self):
        for disk in ({'target': '/mnt/new', 'uuid': 'disk', 'fstype': 'xfs', 'options': 'rw'},
                     {'target': '/mnt/new', 'uuid': 'disk', 'fstype': 'ext4', 'options': 'ro'},
                     {'target': '/', 'uuid': 'root', 'fstype': 'ext4', 'options': 'rw'},
                     {'target': '/mnt/new', 'uuid': 'root', 'fstype': 'ext4', 'options': 'rw'}):
            with patch.object(d, 'run', side_effect=[json.dumps({'filesystems': [disk]}), json.dumps({'filesystems': [{'uuid': 'root'}]})]):
                with self.assertRaises(ValueError):
                    d.validate_mount('/mnt/new')

    def test_rejects_shell_paths_and_symlinks_without_commands(self):
        with tempfile.TemporaryDirectory() as temp:
            symlink = Path(temp) / 'link'
            symlink.symlink_to(Path(temp))
            for path in ('/', '/etc', '/mnt/../disk', '/mnt/a b', '/mnt/$(id)', str(symlink)):
                with patch.object(d, 'run') as command:
                    with self.assertRaises(ValueError):
                        d.validate_mount(path)
                    command.assert_not_called()


class DestinationRepositoryTests(unittest.TestCase):
    def setUp(self):
        binary = os.environ.get('RESTIC_TEST_BIN') or shutil.which('restic')
        if not binary or not Path(binary).is_file():
            self.skipTest('Set RESTIC_TEST_BIN to run actual repository migration tests')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        bindir = self.root / 'bin'
        bindir.mkdir()
        (bindir / 'restic').symlink_to(binary)
        self.environment = patch.dict(os.environ, {'PATH': str(bindir) + os.pathsep + os.environ['PATH']})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.old = self.root / 'old'
        self.new = self.root / 'new'
        self.old.mkdir()
        self.new.mkdir()
        password = self.root / 'password'
        password.write_text('test-password')
        password.chmod(0o600)
        self.config = {'name': 'test', 'project': 'test', 'mount': str(self.old), 'disk_uuid': 'old-disk',
                       'password_file': str(password), 'state_dir': str(self.root / 'state'), 'minimum_free_gib': 0}
        self.config_path = self.root / 'config.json'
        b.atomic_json(self.config_path, self.config)
        self.service = b.Service(self.config)
        self.service.restic('init')
        files = self.root / 'source'
        files.mkdir()
        (files / 'object.txt').write_text('actual stored object bytes')
        output = self.service.restic('backup', str(files), '--json', '--tag', 'test,complete', '--host', 'test')
        self.snapshot = json.loads(output.splitlines()[-1])['snapshot_id']
        self.service.status(last_success=b.now().isoformat(), snapshot_id=self.snapshot)
        b.atomic_json(self.service.state / 'restore-verified.json', {'time': b.now().isoformat(), 'snapshot_id': self.snapshot})
        b.atomic_json(self.service.state / 'restore-report.json', {'file_checksum_restore': True})
        self.systemd = self.root / 'systemd'
        self.systemd.mkdir()
        for unit in ('homeserver-backup.service', 'homeserver-backup-maintenance.service', 'homeserver-backup-verify.service'):
            (self.systemd / unit).write_text('[Unit]\nRequiresMountsFor=' + str(self.old) + '\n[Service]\nExecStart=/bin/true\n')
        self.disk = patch.object(b.Service, 'disk', lambda service: shutil.disk_usage(service.c['mount']))
        self.disk.start()
        self.addCleanup(self.disk.stop)
        self.mount = patch.object(d, 'validate_mount', return_value={'uuid': 'new-disk'})
        self.mount.start()
        self.addCleanup(self.mount.stop)
        self.commands = patch.object(d, 'run', return_value='')
        self.command = self.commands.start()
        self.addCleanup(self.commands.stop)

    def journal(self, mode):
        b.atomic_json(d.request_path(self.service), {'mount': str(self.new), 'uuid': 'new-disk',
                      'mode': mode, 'source': dict(self.config), 'token': 'test-token'})

    def test_migrate_preserves_ids_bytes_proof_and_old_repository(self):
        self.journal('migrate')
        d.work(self.config_path, self.systemd)
        migrated = b.Service(b.read_json(self.config_path))
        self.assertEqual(migrated.c['mount'], str(self.new))
        self.assertEqual(migrated.snapshots()[0]['id'][:8], self.snapshot[:8])
        self.assertEqual(migrated.restic('dump', self.snapshot, str(self.root / 'source/object.txt')), 'actual stored object bytes')
        self.assertTrue((self.old / 'restic/config').is_file())
        self.assertEqual(b.read_json(self.service.state / 'restore-verified.json')['snapshot_id'], self.snapshot)
        self.assertFalse(d.request_path(self.service).exists())
        override = (self.systemd / 'homeserver-backup.service').read_text()
        self.assertIn('RequiresMountsFor=' + str(self.new), override)
        self.assertNotIn(str(self.old), override)
        # A redundant worker invocation is harmless.
        d.work(self.config_path, self.systemd)

    def test_fresh_repository_drops_old_success_and_restore_claims(self):
        self.journal('fresh')
        d.work(self.config_path, self.systemd)
        fresh = b.Service(b.read_json(self.config_path))
        self.assertEqual(fresh.snapshots(), [])
        self.assertEqual(b.read_json(self.service.status_file), {})
        self.assertFalse((self.service.state / 'restore-verified.json').exists())
        self.assertTrue((self.old / 'restic/config').is_file())

    def test_copy_failure_keeps_config_and_retry_converges(self):
        self.journal('migrate')
        with patch.object(d.shutil, 'copytree', side_effect=RuntimeError('disk full')):
            with self.assertRaisesRegex(RuntimeError, 'disk full'):
                d.work(self.config_path, self.systemd)
        self.assertEqual(b.read_json(self.config_path), self.config)
        self.assertEqual(d.destination_state(self.service)['error'], 'disk full')
        with self.assertRaisesRegex(RuntimeError, 'Destination change is pending'):
            self.service.ensure_no_destination_change()
        d.work(self.config_path, self.systemd)
        self.assertEqual(b.read_json(self.config_path)['mount'], str(self.new))

    def test_failure_after_config_switch_retries_finalization(self):
        self.journal('fresh')
        with patch.object(d, 'update_mount_dependencies', side_effect=RuntimeError('systemd failed')):
            with self.assertRaises(RuntimeError):
                d.work(self.config_path, self.systemd)
        self.assertEqual(b.read_json(self.config_path)['mount'], str(self.new))
        self.assertTrue(d.request_path(self.service).exists())
        d.work(self.config_path, self.systemd)
        self.assertFalse(d.request_path(self.service).exists())

    def test_wrong_disk_or_unrelated_repository_never_switches(self):
        self.journal('fresh')
        with patch.object(d, 'validate_mount', return_value={'uuid': 'wrong'}):
            with self.assertRaisesRegex(RuntimeError, 'UUID changed'):
                d.work(self.config_path, self.systemd)
        self.assertEqual(b.read_json(self.config_path), self.config)
        target = self.new / 'restic'
        target.mkdir()
        (target / 'important').write_text('preserve')
        with self.assertRaisesRegex(RuntimeError, 'does not belong'):
            d.work(self.config_path, self.systemd)
        self.assertEqual((target / 'important').read_text(), 'preserve')
        self.assertEqual(b.read_json(self.config_path), self.config)

    def test_corrupted_copy_cannot_switch_configuration(self):
        self.journal('migrate')
        copytree = shutil.copytree
        def corrupt(source, target, *args, **kwargs):
            result = copytree(source, target, *args, **kwargs)
            for pack in (Path(target) / 'data').glob('*/*'):
                pack.chmod(0o600)
                pack.write_bytes(b'corrupted pack')
                break
            return result
        with patch.object(d.shutil, 'copytree', side_effect=corrupt):
            with self.assertRaises(RuntimeError):
                d.work(self.config_path, self.systemd)
        self.assertEqual(b.read_json(self.config_path), self.config)
        self.assertTrue((self.old / 'restic/config').exists())

    def test_published_repository_retries_after_configuration_write_failure(self):
        self.journal('fresh')
        atomic = b.atomic_json
        def fail(path, value):
            if path == self.config_path:
                raise RuntimeError('config write failed')
            atomic(path, value)
        with patch.object(d, 'atomic_json', side_effect=fail):
            with self.assertRaisesRegex(RuntimeError, 'config write failed'):
                d.work(self.config_path, self.systemd)
        self.assertTrue((self.new / 'restic/config').exists())
        self.assertEqual(b.read_json(self.config_path), self.config)
        d.work(self.config_path, self.systemd)
        self.assertEqual(b.read_json(self.config_path)['mount'], str(self.new))

    def test_cancel_preserves_source_and_target_files(self):
        self.journal('fresh')
        with patch.object(control, 'job_states', return_value=[]):
            d.retry_or_cancel(self.service, 'destination_cancel', self.config_path)
        self.assertEqual(b.read_json(self.config_path), self.config)
        self.assertTrue((self.old / 'restic/config').exists())
        self.assertFalse(d.request_path(self.service).exists())


if __name__ == '__main__':
    unittest.main()
