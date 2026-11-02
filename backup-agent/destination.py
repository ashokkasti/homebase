#!/usr/bin/env python3
"""Journaled, non-destructive switch to a separately mounted backup disk."""
import json
import os
from pathlib import Path
import re
import shutil
import sys
import uuid

from backup_service import Service, atomic_json, discover, inspect_all, log, overlaps, read_json, run

UNIT = 'homeserver-backup-destination.service'


def request_path(service):
    return service.state / 'destination-request.json'


def destination_state(service):
    value = read_json(request_path(service))
    if not value:
        return {'kind': 'idle'}
    return {'kind': 'pending', 'mount': value['mount'], 'mode': value['mode'], 'error': value.get('error')}


def validate_mount(value):
    if (not isinstance(value, str) or len(value) > 512 or
            not re.fullmatch(r'/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+', value) or
            any(p in ('.', '..') for p in value.split('/'))):
        raise ValueError('Enter an absolute mounted disk path without spaces or shell characters.')
    path = Path(value)
    if path.resolve() != path or value in ('/etc', '/var', '/home', '/boot', '/data', '/opt', '/usr', '/run', '/proc', '/sys', '/dev'):
        raise ValueError('Choose a dedicated backup mount without symlinks.')
    disk = json.loads(run(['findmnt', '--json', '--mountpoint', value, '--output', 'TARGET,UUID,FSTYPE,OPTIONS']))['filesystems'][0]
    if (disk.get('target') != value or not disk.get('uuid') or
            disk.get('fstype') != 'ext4' or 'rw' not in disk.get('options', '').split(',')):
        raise ValueError('Destination must be a distinct filesystem mounted read-write as ext4.')
    root = json.loads(run(['findmnt', '--json', '--mountpoint', '/', '--output', 'UUID']))['filesystems'][0]
    if disk['uuid'] == root.get('uuid'):
        raise ValueError('The server root filesystem cannot be the backup destination.')
    return disk


def validate_target(service, mount, mode):
    if mode not in ('migrate', 'fresh'):
        raise ValueError('Choose migrate or fresh.')
    disk = validate_mount(mount)
    if disk['uuid'] == service.c['disk_uuid'] or overlaps(mount, service.c['mount']):
        raise ValueError('Choose a different mounted filesystem from the current backup disk.')
    if overlaps(mount, service.state):
        raise ValueError('Destination cannot contain service state.')
    layout = discover(service.c, inspect_all())
    if any(overlaps(mount, source) for source in layout['sources']):
        raise ValueError('Destination overlaps protected source data.')
    if (Path(mount) / 'restic').exists() or (Path(mount) / 'restic').is_symlink():
        raise ValueError('The destination already contains a restic repository. Choose an unused backup mount.')
    if mode == 'migrate':
        service.disk()
        size = repository_size(service.repo)
    else:
        size = 0
    reserve = service.c.get('minimum_free_gib', 20) * 1024**3
    if shutil.disk_usage(mount).free < size + reserve:
        raise ValueError('Destination has insufficient space for the repository plus the free-space reserve.')
    return disk


def repository_size(path):
    total = 0
    for parent, dirs, files in os.walk(path, followlinks=False):
        for name in dirs + files:
            item = Path(parent) / name
            if item.is_symlink():
                raise RuntimeError('Repository contains a symlink; refusing to copy it.')
        total += sum((Path(parent) / name).stat().st_size for name in files)
    if not (path / 'config').is_file():
        raise RuntimeError('Source repository is not initialized.')
    return total


def queue(service, mount, mode, config_path):
    from control import active, job_states, mutation_lock
    with mutation_lock(service):
        if active(job_states()):
            raise RuntimeError('Wait for the active backup operation before changing destination.')
        with service.lock():
            if request_path(service).exists():
                raise RuntimeError('A destination change is pending. Retry or cancel it first.')
            if service.journal.exists() or (service.state / 'restore-recovery.json').exists():
                raise RuntimeError('Recover the interrupted operation before changing destination.')
            disk = validate_target(service, mount, mode)
            atomic_json(request_path(service), {
                'mount': mount, 'uuid': disk['uuid'], 'mode': mode, 'source': dict(service.c),
                'token': uuid.uuid4().hex,
            })
        # Pending journal blocks other operations before the worker takes the lock.
        run(['systemctl', 'start', '--no-block', UNIT])
    return {'ok': True, 'message': 'Destination change queued. The old repository will be preserved.'}


def retry_or_cancel(service, action, config_path):
    from control import active, job_states, mutation_lock
    with mutation_lock(service):
        if active(job_states()):
            raise RuntimeError('Wait for the active operation.')
        value = read_json(request_path(service))
        if not value:
            raise RuntimeError('No destination change is pending.')
        if action == 'destination_cancel':
            with service.lock():
                current = read_json(config_path)
                if current['mount'] != value['source']['mount']:
                    raise RuntimeError('The destination has switched. Retry to complete finalization.')
                request_path(service).unlink()
            return {'ok': True, 'message': 'Destination change cancelled. The old destination remains active; staged copies are retained.'}
        run(['systemctl', 'start', '--no-block', UNIT])
    return {'ok': True, 'message': 'Destination change retry queued'}


def update_mount_dependencies(mount, systemd):
    # RequiresMountsFor cannot be cleared by an empty drop-in on Ubuntu's systemd.
    # Update only the mount line in the three unit files owned by this installer.
    for unit in ('homeserver-backup.service', 'homeserver-backup-maintenance.service',
                 'homeserver-backup-verify.service'):
        path = systemd / unit
        if path.is_symlink():
            raise RuntimeError('Managed backup units cannot be symlinks.')
        content, count = re.subn(r'^RequiresMountsFor=.*$', 'RequiresMountsFor=' + mount,
                                 path.read_text(), flags=re.MULTILINE)
        if count != 1:
            raise RuntimeError('Expected one mount requirement in ' + unit)
        tmp = path.with_suffix('.tmp')
        with tmp.open('w') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    sync_directory(systemd)
    run(['systemctl', 'daemon-reload'])


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def sync_tree(path):
    for parent, dirs, files in os.walk(path, topdown=False):
        for name in files:
            with (Path(parent) / name).open('rb') as handle:
                os.fsync(handle.fileno())
        sync_directory(parent)


def work(config_path, systemd):
    service = Service(read_json(config_path))
    with service.lock():
        value = read_json(request_path(service))
        if not value:
            return
        try:
            target = validate_mount(value['mount'])
            if target['uuid'] != value['uuid']:
                raise RuntimeError('Destination disk UUID changed; refusing to write.')
            current = read_json(config_path)
            new_config = dict(value['source'], mount=value['mount'], disk_uuid=value['uuid'])
            if current not in (value['source'], new_config):
                raise RuntimeError('Host configuration changed during destination migration.')
            destination = Service(new_config)
            destination.disk()
            stage = Path(value['mount']) / ('.homebase-restic-' + value['token'])
            if not destination.repo.exists():
                if stage.exists():
                    # Only this journal's private staging directory may be replaced on retry.
                    if stage.is_symlink():
                        raise RuntimeError('Staging path cannot be a symlink.')
                    shutil.rmtree(stage)
                if value['mode'] == 'migrate':
                    source = Service(value['source'])
                    source.disk()
                    size = repository_size(source.repo)
                    if shutil.disk_usage(value['mount']).free < size + new_config.get('minimum_free_gib', 20) * 1024**3:
                        raise RuntimeError('Insufficient destination space for migration and reserve.')
                    source.restic('check', '--read-data', timeout=86400)
                    log('destination_copy_started')
                    shutil.copytree(source.repo, stage, ignore=shutil.ignore_patterns('locks'))
                    (stage / 'locks').mkdir(exist_ok=True)
                else:
                    stage.mkdir(mode=0o700)
                    staged = Service(new_config)
                    staged.repo = stage
                    staged.restic('init')
                staged = Service(new_config)
                staged.repo = stage
                staged.restic('check', '--read-data', timeout=86400)
                if value['mode'] == 'migrate':
                    source_snapshots = json.loads(source.restic('snapshots', '--json'))
                    staged_snapshots = json.loads(staged.restic('snapshots', '--json'))
                    if {s['id'] for s in source_snapshots} != {s['id'] for s in staged_snapshots}:
                        raise RuntimeError('Copied repository snapshot IDs do not match.')
                # The private token marker proves ownership if interrupted after rename.
                (stage / '.homebase-destination-token').write_text(value['token'])
                sync_tree(stage)
                os.rename(stage, destination.repo)
                sync_directory(destination.repo.parent)
            marker = destination.repo / '.homebase-destination-token'
            if not marker.is_file() or marker.read_text() != value['token']:
                raise RuntimeError('Destination repository does not belong to this change.')
            destination.restic('check', '--read-data', timeout=86400)
            atomic_json(config_path, new_config)
            # Journal remains until configuration, status and systemd all converge.
            if value['mode'] == 'fresh':
                atomic_json(destination.status_file, {})
                for name in ('restore-verified.json', 'restore-report.json'):
                    (destination.state / name).unlink(missing_ok=True)
            update_mount_dependencies(value['mount'], systemd)
            request_path(service).unlink()
            sync_directory(service.state)
            log('destination_change_complete', mode=value['mode'])
        except Exception as error:
            value['error'] = str(error)
            atomic_json(request_path(service), value)
            log('destination_change_failed', error=str(error))
            raise


if __name__ == '__main__':
    if os.geteuid() != 0:
        raise SystemExit('Root access is required.')
    os.umask(0o077)
    try:
        work(Path('/etc/homeserver-backup/config.json'), Path('/etc/systemd/system'))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
