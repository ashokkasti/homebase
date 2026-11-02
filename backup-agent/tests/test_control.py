import copy
import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import backup_service as b
import control as c


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config_path = self.root / 'config.json'
        self.systemd = self.root / 'systemd'
        self.config = {'name': 'test', 'project': 'p', 'mount': str(self.root / 'disk'),
                       'disk_uuid': 'disk', 'state_dir': str(self.root / 'state'),
                       'password_file': str(self.root / 'password')}
        b.atomic_json(self.config_path, self.config)
        self.service = b.Service(self.config)
        self.service.status(last_success=b.now().isoformat())
        b.atomic_json(self.service.state / 'restore-verified.json', {'time': b.now().isoformat()})
        self.value = {'time': '03:15', 'timezone': 'Asia/Kathmandu', 'retentionDays': 30, 'minimumFreeGiB': 20, 'enabled': True}

    def test_rejects_injection_and_unexpected_privileged_fields(self):
        for changes in ({'time': '02:00\nExecStart=/bin/sh'}, {'timezone': 'UTC;id'},
                        {'timezone': '../etc'}, {'retentionDays': True}, {'enabled': 1},
                        {'mount': '/etc'}, {'retentionDays': 0}):
            value = {**self.value, **changes}
            with self.assertRaises(ValueError):
                c.validate_settings(value)

    def test_settings_reads_effective_calendar_override(self):
        with patch.object(c, 'properties', return_value={'UnitFileState': 'enabled'}), \
             patch.object(c, 'run', return_value='[Timer]\nOnCalendar=\nOnCalendar=*-*-* 03:15:00 Europe/London\n'):
            settings = c.settings(self.service)
        self.assertEqual(settings['time'], '03:15')
        self.assertEqual(settings['timezone'], 'Europe/London')

    def test_configure_updates_retention_and_timer_override(self):
        commands = []
        with patch.object(c, 'CONFIG', self.config_path), patch.object(c, 'SYSTEMD', self.systemd), \
             patch.object(c, 'job_states', return_value=[]), patch.object(self.service, 'disk'), \
             patch.object(c, 'properties', return_value={'UnitFileState': 'disabled', 'ActiveState': 'inactive'}), \
             patch.object(c, 'run', side_effect=lambda args: commands.append(args) or ''):
            c.configure(self.service, self.value)
        self.assertEqual(b.read_json(self.config_path)['schedule_time'], '03:15')
        self.assertEqual(b.read_json(self.config_path)['retention_days'], 30)
        text = (self.systemd / 'homeserver-backup.timer.d/schedule.conf').read_text()
        self.assertIn('OnCalendar=\nOnCalendar=*-*-* 03:15:00 Asia/Kathmandu', text)
        self.assertTrue(any('homeserver-backup-health.timer' in cmd and 'enable' in cmd for cmd in commands))
        self.assertEqual(self.config_path.stat().st_mode & 0o777, 0o600)

    def test_failure_rolls_back_config_and_timer_states(self):
        before = self.config_path.read_bytes()
        commands = []
        failed = False
        def command(args):
            nonlocal failed
            commands.append(args)
            if args[:3] == ['systemctl', 'enable', '--now'] and not failed:
                failed = True
                raise RuntimeError('systemd failed')
            return ''
        with patch.object(c, 'CONFIG', self.config_path), patch.object(c, 'SYSTEMD', self.systemd), \
             patch.object(c, 'job_states', return_value=[]), patch.object(self.service, 'disk'), \
             patch.object(c, 'properties', return_value={'UnitFileState': 'disabled', 'ActiveState': 'inactive'}), \
             patch.object(c, 'run', side_effect=command):
            with self.assertRaisesRegex(RuntimeError, 'systemd failed'):
                c.configure(self.service, self.value)
        self.assertEqual(self.config_path.read_bytes(), before)
        self.assertFalse((self.systemd / 'homeserver-backup.timer.d/schedule.conf').exists())
        self.assertIn(['systemctl', 'disable', 'homeserver-backup-health.timer'], commands)
        self.assertIn(['systemctl', 'stop', 'homeserver-backup-health.timer'], commands)

    def test_unverified_first_backup_cannot_enable_schedule(self):
        (self.service.state / 'restore-verified.json').unlink()
        with patch.object(c, 'CONFIG', self.config_path), patch.object(c, 'job_states', return_value=[]), \
             patch.object(c, 'properties', return_value={'UnitFileState': 'disabled'}), patch.object(c, 'run'):
            with self.assertRaisesRegex(RuntimeError, 'verify its restore'):
                c.configure(self.service, self.value)
        self.assertEqual(b.read_json(self.config_path), self.config)

    def test_active_operation_blocks_settings_before_writes(self):
        with patch.object(c, 'job_states', return_value=[{'state': 'activating'}]):
            with self.assertRaisesRegex(RuntimeError, 'active backup'):
                c.configure(self.service, self.value)
        self.assertEqual(b.read_json(self.config_path), self.config)

    def test_trigger_only_queues_installed_fixed_units(self):
        with patch.object(c, 'job_states', return_value=[]), patch.object(self.service, 'disk'), \
             patch.object(c, 'run') as run:
            c.trigger(self.service, 'backup')
        run.assert_called_once_with(['systemctl', 'start', '--no-block', 'homeserver-backup.service'])
        with self.assertRaises(ValueError):
            c.trigger(self.service, 'backup;id')

    def test_job_is_started_after_releasing_operation_lock(self):
        def start(args):
            worker = b.Service(self.config)
            with worker.lock():
                pass
            return ''
        with patch.object(c, 'job_states', return_value=[]), patch.object(self.service, 'disk'), \
             patch.object(c, 'run', side_effect=start):
            c.trigger(self.service, 'backup')

    def test_wrong_disk_does_not_show_host_free_space_or_snapshots(self):
        self.service.status(last_success=b.now().isoformat())
        b.atomic_json(self.service.state / 'restore-verified.json', {'time': b.now().isoformat()})
        with patch.object(self.service, 'disk', side_effect=RuntimeError('wrong UUID')), \
             patch.object(c, 'snapshot_rows') as snapshots, patch.object(c, 'job_states', return_value=[]), \
             patch.object(c, 'settings', return_value={}):
            result = c.overview(self.service)
        snapshots.assert_not_called()
        self.assertEqual(result['disk']['kind'], 'unavailable')
        self.assertNotIn('freeBytes', result['disk'])
        self.assertEqual(result['health'], 'attention')
        self.assertFalse(result['historyComplete'])

    def test_pending_snapshot_is_not_mislabeled_complete(self):
        raw = [{'id': 'a'*64, 'time': b.now().isoformat(), 'tags': ['test', 'pending']},
               {'id': 'b'*64, 'time': b.now().isoformat(), 'tags': ['test', 'complete']}]
        with patch.object(self.service, 'restic', return_value=json.dumps(raw)):
            result = c.snapshot_rows(self.service)
        self.assertEqual({r['id']: r['state'] for r in result}, {'a'*64: 'incomplete', 'b'*64: 'complete'})
        self.assertTrue(all(r['bytes'] is None for r in result))

    def test_retention_uses_configured_days(self):
        self.service.c['retention_days'] = 14
        b.atomic_json(self.service.state / 'restore-verified.json', {'time': b.now().isoformat()})
        commands = []
        def restic(*args):
            commands.append(args)
            return '[]'
        with patch.object(self.service, 'disk'), \
             patch.object(self.service, 'snapshots', return_value=[{'time': b.now().isoformat()}]), \
             patch.object(self.service, 'restic', side_effect=restic):
            self.service.maintenance()
        forget = next(args for args in commands if args[0] == 'forget')
        self.assertEqual(forget[-1], '14d')


if __name__ == '__main__':
    unittest.main()
