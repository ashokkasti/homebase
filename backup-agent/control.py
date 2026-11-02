#!/usr/bin/env python3
"""Restricted JSON control surface for Homebase over authenticated SSH."""
import contextlib
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from backup_service import VERSION, Service, atomic_json, now, read_json, run

UNITS = {
    'backup': 'homeserver-backup.service',
    'verify': 'homeserver-backup-verify.service',
    'maintenance': 'homeserver-backup-maintenance.service',
    'destination': 'homeserver-backup-destination.service',
}
CONFIG = Path('/etc/homeserver-backup/config.json')
SYSTEMD = Path('/etc/systemd/system')


def properties(unit):
    text = run(['systemctl', 'show', unit, '--property',
                'LoadState,ActiveState,SubState,Result,ExecMainStatus,NextElapseUSecRealtime,UnitFileState'])
    return dict(line.split('=', 1) for line in text.splitlines() if '=' in line)


def job_states():
    return [{'kind': kind, 'state': p.get('ActiveState', 'unknown'),
             'result': p.get('Result', 'unknown'), 'exitCode': int(p.get('ExecMainStatus') or '0')}
            for kind, unit in UNITS.items() for p in [properties(unit)]]


def active(jobs):
    return any(j['state'] in ('active', 'activating', 'deactivating', 'reloading') for j in jobs)


def settings(service):
    config = service.c
    timer = properties('homeserver-backup.timer')
    # Upgrade legacy installs without pretending a timer value was observed.
    time = config.get('schedule_time', '02:00')
    timezone = config.get('schedule_timezone', 'Asia/Kathmandu')
    # Read the effective supported calendar, including external timer overrides.
    for line in run(['systemctl', 'cat', 'homeserver-backup.timer']).splitlines():
        match = re.fullmatch(r'OnCalendar=\*-\*-\* ([0-2][0-9]:[0-5][0-9]):00 ([A-Za-z0-9_+./-]+)', line.strip())
        if match:
            time, timezone = match.groups()
    next_run = None
    next_text = timer.get('NextElapseUSecRealtime', '')
    if next_text:
        try:
            next_run = run(['date', '--date', next_text, '--iso-8601=seconds']).strip()
        except Exception:
            pass
    return {'time': time, 'timezone': timezone, 'retentionDays': config.get('retention_days', 30),
            'minimumFreeGiB': config.get('minimum_free_gib', 20),
            'enabled': timer.get('UnitFileState') in ('enabled', 'enabled-runtime'),
            'nextRun': next_run, 'mount': config['mount'], 'project': config['project']}


def snapshot_rows(service):
    raw = json.loads(service.restic('snapshots', '--json', '--host', service.c['name'],
                                    '--tag', service.c['name'], timeout=12))
    rows = []
    for item in raw:
        tags = item.get('tags') or []
        summary = item.get('summary') or {}
        rows.append({'id': item['id'], 'time': item['time'],
                     'state': 'complete' if 'complete' in tags else 'incomplete',
                     'bytes': summary.get('total_bytes_processed'),
                     'addedBytes': summary.get('data_added'), 'files': summary.get('total_files_processed'),
                     'durationSeconds': summary.get('total_duration')})
    return sorted(rows, key=lambda r: r['time'], reverse=True)


def overview(service):
    status = read_json(service.status_file, {})
    restore = read_json(service.state / 'restore-report.json', {})
    attestation = read_json(service.state / 'restore-verified.json', {})
    problems = []
    disk = {'kind': 'unavailable', 'message': 'Disk not checked'}
    rows = []
    complete_history = True
    try:
        usage = service.disk()
        disk = {'kind': 'mounted', 'totalBytes': usage.total, 'freeBytes': usage.free, 'usedBytes': usage.used,
                'uuid': service.c['disk_uuid']}
        if usage.free < service.c.get('minimum_free_gib', 20) * 1024**3:
            problems.append('Backup disk is below the free-space threshold.')
        try:
            rows = snapshot_rows(service)
        except Exception:
            complete_history = False
            problems.append('Snapshot history is temporarily unavailable; the repository may be busy.')
    except Exception as e:
        disk = {'kind': 'unavailable', 'message': str(e)}
        complete_history = False
        problems.append('The configured backup disk is unavailable or has a different identity.')
    jobs = job_states()
    running = active(jobs)
    successful = status.get('last_success')
    if not successful:
        problems.append('No successful backup has been recorded.')
    elif (now() - dt.datetime.fromisoformat(successful)).total_seconds() > 26 * 3600:
        problems.append('The last successful backup is older than 26 hours.')
    for key, message in [('error', 'The most recent backup attempt failed.'),
                         ('restore_error', 'The most recent restore verification failed.'),
                         ('maintenance_error', 'Backup maintenance failed.')]:
        if status.get(key):
            problems.append(message)
    if not attestation or (now() - dt.datetime.fromisoformat(attestation['time'])).days > 45:
        problems.append('Restore verification is missing or older than 45 days; retention deletion is blocked.')
    if service.journal.exists() or (service.state / 'restore-recovery.json').exists():
        if not running:
            problems.append('An interrupted operation needs recovery.')
    from destination import destination_state
    changing = destination_state(service)
    if changing['kind'] == 'pending' and not running:
        problems.append('Destination change needs attention. Retry or cancel it before running backups.')
    health = 'running' if running else 'attention' if problems else 'healthy'
    return {'kind': 'ready', 'version': VERSION, 'name': service.c['name'],
            'canChangeDestination': True, 'settings': settings(service), 'health': health, 'problems': problems, 'jobs': jobs,
            'lastSuccess': successful, 'lastAttempt': status.get('last_attempt'),
            'lastDurationSeconds': status.get('duration_seconds'), 'latestSnapshotId': status.get('snapshot_id'),
            'disk': disk, 'snapshots': rows, 'historyComplete': complete_history,
            'restore': {'time': attestation.get('time'), 'snapshotId': attestation.get('snapshot_id'),
                        'filesVerified': restore.get('file_checksum_restore', False),
                        'databaseVerified': bool(restore.get('postgres_clone_sql')),
                        'counts': restore.get('postgres_clone_sql'), 'storageApiVerified': False},
            'retentionState': status.get('retention', 'not_checked'), 'destinationChange': changing}


@contextlib.contextmanager
def mutation_lock(service):
    with (service.state / 'control.lock').open('a') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another backup control request is in progress.') from None
        yield


def trigger(service, kind):
    if kind not in UNITS:
        raise ValueError('Unsupported backup action')
    with mutation_lock(service):
        if active(job_states()):
            raise RuntimeError('A backup, verification, or maintenance operation is already running.')
        with service.lock():
            service.ensure_no_destination_change()
            service.disk()
            if service.journal.exists() or (service.state / 'restore-recovery.json').exists():
                raise RuntimeError('Recover the interrupted operation on the host before starting another.')
        # Release the operation lock before starting a worker that needs that lock.
        run(['systemctl', 'start', '--no-block', UNITS[kind]])
    return {'ok': True, 'message': kind + ' queued'}


def validate_settings(value):
    keys = {'time', 'timezone', 'retentionDays', 'minimumFreeGiB', 'enabled'}
    if not isinstance(value, dict) or set(value) != keys:
        raise ValueError('Expected only time, timezone, retentionDays, minimumFreeGiB, enabled')
    if not isinstance(value['time'], str) or not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]', value['time']):
        raise ValueError('Time must be HH:MM in 24-hour format')
    if not isinstance(value['timezone'], str) or len(value['timezone']) > 80 or re.search(r'[^A-Za-z0-9_+/.-]', value['timezone']):
        raise ValueError('Invalid timezone')
    try:
        ZoneInfo(value['timezone'])
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError('Unknown timezone') from None
    for key, lo, hi in [('retentionDays', 1, 365), ('minimumFreeGiB', 1, 10000)]:
        if isinstance(value[key], bool) or not isinstance(value[key], int) or not lo <= value[key] <= hi:
            raise ValueError(key + ' is outside its supported range')
    if not isinstance(value['enabled'], bool):
        raise ValueError('enabled must be boolean')
    return value


def configure(service, value):
    value = validate_settings(value)
    with mutation_lock(service):
        if active(job_states()):
            raise RuntimeError('Wait for the active backup operation before changing settings.')
        service.ensure_no_destination_change()
        calendar = f'*-*-* {value["time"]}:00 {value["timezone"]}'
        run(['systemd-analyze', 'calendar', calendar])
        dropins = {
            'homeserver-backup.timer': calendar,
            'homeserver-backup-maintenance.timer': f'*-*-* 04:00:00 {value["timezone"]}',
            'homeserver-backup-verify.timer': f'*-*-01 05:00:00 {value["timezone"]}',
        }
        timer_states = {unit: properties(unit) for unit in
                        ('homeserver-backup.timer', 'homeserver-backup-maintenance.timer',
                         'homeserver-backup-verify.timer', 'homeserver-backup-health.timer')}
        if value['enabled'] and timer_states['homeserver-backup.timer'].get('UnitFileState') not in ('enabled', 'enabled-runtime'):
            status = read_json(service.status_file, {})
            proof = read_json(service.state / 'restore-verified.json', {})
            if (not status.get('last_success') or not proof.get('time') or status.get('restore_error') or
                    (now() - dt.datetime.fromisoformat(status['last_success'])).total_seconds() > 26 * 3600 or
                    (now() - dt.datetime.fromisoformat(proof['time'])).days > 45):
                raise RuntimeError('Run a backup and verify its restore before enabling the nightly schedule.')
            service.disk()
        old_config = CONFIG.read_bytes()
        backups = {}
        for unit in dropins:
            path = SYSTEMD / (unit + '.d') / 'schedule.conf'
            backups[path] = path.read_bytes() if path.exists() else None
        config = dict(service.c, schedule_time=value['time'], schedule_timezone=value['timezone'],
                      retention_days=value['retentionDays'], minimum_free_gib=value['minimumFreeGiB'])
        try:
            with service.lock():
                atomic_json(CONFIG, config)
                for unit, expression in dropins.items():
                    path = SYSTEMD / (unit + '.d') / 'schedule.conf'
                    path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
                    tmp = path.with_suffix('.tmp')
                    tmp.write_text('[Timer]\nOnCalendar=\nOnCalendar=' + expression + '\n')
                    os.chmod(tmp, 0o644)
                    os.replace(tmp, path)
                run(['systemctl', 'daemon-reload'])
            # Timer activation may immediately launch a missed persistent job.
            # Never hold its operation lock while asking systemd to start it.
            run(['systemctl', 'enable' if value['enabled'] else 'disable', '--now', 'homeserver-backup.timer'])
            if value['enabled']:
                run(['systemctl', 'enable', '--now', 'homeserver-backup-maintenance.timer',
                     'homeserver-backup-verify.timer', 'homeserver-backup-health.timer'])
            for unit in ('homeserver-backup-maintenance.timer', 'homeserver-backup-verify.timer'):
                run(['systemctl', 'try-restart', unit])
            service.c.update(config)
        except Exception:
            with service.lock():
                atomic_json(CONFIG, json.loads(old_config))
                for path, content in backups.items():
                    if content is None:
                        path.unlink(missing_ok=True)
                    else:
                        path.write_bytes(content)
                run(['systemctl', 'daemon-reload'])
            for unit, previous in timer_states.items():
                was_enabled = previous.get('UnitFileState') in ('enabled', 'enabled-runtime')
                run(['systemctl', 'enable' if was_enabled else 'disable', unit])
                run(['systemctl', 'restart' if previous.get('ActiveState') == 'active' else 'stop', unit])
            raise
    return {'ok': True, 'message': 'Backup settings saved'}


def logs():
    output = run(['journalctl', '--no-pager', '--output=json', '--lines=80',
                  *[arg for unit in UNITS.values() for arg in ('--unit', unit)]])
    rows = []
    for line in output.splitlines():
        try:
            entry = json.loads(line)
            # Agent messages are structured JSON without environment values or credentials.
            message = json.loads(entry.get('MESSAGE', ''))
            if isinstance(message, dict) and isinstance(message.get('event'), str):
                rows.append({'time': message.get('time', ''), 'event': message['event'],
                             'container': message.get('container'), 'snapshot': message.get('snapshot'),
                             'error': message.get('error')})
        except (ValueError, TypeError):
            continue
    return {'events': rows[-50:]}


def main():
    if os.geteuid() != 0:
        raise SystemExit('Backup controls require root or passwordless sudo')
    os.umask(0o077)
    try:
        value = json.load(sys.stdin)
        if not isinstance(value, dict):
            raise ValueError('Expected an object')
        action = value.get('action')
        if action == 'probe' or (action == 'overview' and not CONFIG.exists()):
            result = {'kind': 'not_installed', 'legacy': CONFIG.exists(), 'mount': '/srv/backups', 'project': ''}
        elif not CONFIG.exists():
            raise RuntimeError('Install the backup service before using its controls.')
        elif action == 'logs':
            result = logs()
        else:
            service = Service(read_json(CONFIG))
            if action == 'overview':
                result = overview(service)
            elif action == 'configure':
                result = configure(service, value.get('settings'))
            elif action == 'destination':
                from destination import queue
                result = queue(service, value.get('mount'), value.get('mode'), CONFIG)
            elif action in ('destination_retry', 'destination_cancel'):
                from destination import retry_or_cancel
                result = retry_or_cancel(service, action, CONFIG)
            elif action in UNITS:
                result = trigger(service, action)
            else:
                raise ValueError('Unsupported backup action')
        print(json.dumps(result))
        return 0
    except Exception as e:
        print(str(e), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
