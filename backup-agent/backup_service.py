#!/usr/bin/env python3
"""Cold, coordinated Supabase backups. Python stdlib + Docker + Restic."""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid

VERSION = '1.2.0'
DEFAULT_CONFIG = '/etc/homeserver-backup/config.json'


def now():
    return dt.datetime.now(dt.timezone.utc)


def log(event, **fields):
    print(json.dumps({'time': now().isoformat(), 'event': event, **fields}), flush=True)


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(value, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def read_json(path, default=None):
    return json.loads(Path(path).read_text()) if Path(path).exists() else default


def run(args, timeout=120):
    """Kill the entire child process group on timeout, cancellation, or failure."""
    p = subprocess.Popen(args, text=True, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, start_new_session=True)
    try:
        out, err = p.communicate(timeout=timeout)
        if p.returncode:
            # Docker/Restic diagnostics may contain paths. Never print environment/config.
            raise RuntimeError(f'{Path(args[0]).name} {args[1]} failed ({p.returncode}): {err[-1800:]}')
        return out
    except BaseException:
        if p.poll() is None:
            os.killpg(p.pid, signal.SIGTERM)
            try:
                p.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(p.pid, signal.SIGKILL)
                p.communicate()
        raise


def inspect_all():
    ids = run(['docker', 'ps', '-aq']).split()
    return json.loads(run(['docker', 'inspect', *ids])) if ids else []


def name(c):
    return c['Name'].lstrip('/')


def labels(c):
    return c['Config'].get('Labels') or {}


def env(c):
    return dict(s.split('=', 1) for s in c['Config'].get('Env', []) if '=' in s)


def overlaps(a, b):
    a, b = Path(a).resolve(), Path(b).resolve()
    return a == b or a in b.parents or b in a.parents


def source_covers(source, target):
    source, target = Path(source).resolve(), Path(target).resolve()
    return source == target or source in target.parents


def supabase_image(image, component):
    return bool(re.search(r'(^|/)supabase/' + re.escape(component) + r'(:|@)', image))


def stateless_supabase_image(image):
    components = ('storage-api', 'edge-runtime', 'studio', 'postgres-meta', 'gotrue',
                  'realtime', 'logflare', 'supavisor')
    return (any(supabase_image(image, component) for component in components) or
            bool(re.search(r'(^|/)(postgrest/postgrest|kong/kong|library/kong|timberio/vector|darthsim/imgproxy)(:|@)', image)))


def discover(config, containers):
    """Resolve project membership every run; fail on unknown storage backends."""
    members = [c for c in containers if labels(c).get('com.docker.compose.project') == config['project']]
    dbs = [c for c in members if supabase_image(c['Config']['Image'], 'postgres')]
    stores = [c for c in members if supabase_image(c['Config']['Image'], 'storage-api')]
    if len(dbs) != 1 or len(stores) != 1:
        raise RuntimeError('Expected exactly one Supabase PostgreSQL and Storage API container in project')
    db, storage = dbs[0], stores[0]
    storage_env = env(storage)
    backend = storage_env.get('STORAGE_BACKEND', 'file')
    provider = None
    if backend == 's3':
        from urllib.parse import urlparse
        endpoint = urlparse(storage_env.get('GLOBAL_S3_ENDPOINT', '')).hostname
        candidates = []
        for c in members:
            aliases = {name(c), labels(c).get('com.docker.compose.service')}
            for net in c.get('NetworkSettings', {}).get('Networks', {}).values():
                aliases.update(net.get('Aliases') or [])
            if endpoint in aliases and re.match(r'^(rustfs/rustfs|minio/minio)(:|@)', c['Config']['Image']):
                candidates.append(c)
        if len(candidates) != 1:
            raise RuntimeError('S3 storage must resolve to one RustFS/MinIO container in this project; external S3 needs a separate capture strategy')
        provider = candidates[0]
    elif backend != 'file':
        raise RuntimeError(f'Unsupported Storage backend: {backend}')
    pgdata = env(db).get('PGDATA', '/var/lib/postgresql/data')
    mounts = sorted(db['Mounts'], key=lambda m: len(m['Destination']), reverse=True)
    db_dir = None
    for m in mounts:
        destination = Path(m['Destination'])
        if source_covers(destination, pgdata):
            db_dir = str(Path(m['Source']) / Path(pgdata).relative_to(destination))
            break
    if not db_dir:
        raise RuntimeError('PGDATA is not persisted in a supported mount')
    protected = provider if provider else storage
    storage_mounts = [m for m in protected['Mounts'] if m.get('RW') and m['Destination'] != '/var/run/docker.sock']
    if not storage_mounts:
        raise RuntimeError('Storage backend has no persistent writable mount')
    required_storage_paths = [storage_env.get('FILE_STORAGE_BACKEND_PATH', '/var/lib/storage')] if backend == 'file' else ['/data']
    if provider and provider['Config']['Image'].startswith('rustfs/rustfs'):
        required_storage_paths = env(provider).get('RUSTFS_VOLUMES', '/data').split()
    for storage_path in required_storage_paths:
        if not storage_path.startswith('/') or any(c in storage_path for c in '{}*'):
            raise RuntimeError('Custom object-store volume expressions require explicit support')
        if not any(source_covers(m['Destination'], storage_path) for m in storage_mounts):
            raise RuntimeError('Storage data path is not covered by a persistent writable mount')
    sources = set()
    for c in members:
        for m in c.get('Mounts', []):
            if m['Destination'] == '/var/run/docker.sock':
                continue
            if m['Type'] not in ('bind', 'volume'):
                raise RuntimeError('Unsupported mount type')
            sources.add(m['Source'])
        workdir = labels(c).get('com.docker.compose.project.working_dir')
        if workdir:
            sources.add(workdir)
    for item in config.get('extra_sources', []):
        sources.add(item)
    # Parent sources already include children. Stable path ordering aids deduplication.
    sources = sorted(sources, key=lambda x: (len(Path(x).parts), x))
    sources = [s for i, s in enumerate(sources) if not any(source_covers(p, s) for p in sources[:i])]
    extra = config.get('quiesce_containers', [])
    frozen = set(config.get('freeze_containers', []))
    if not frozen.issubset(extra) or any(name(c) in frozen for c in members):
        raise RuntimeError('Only external controllers may use freeze mode; Supabase data containers must stop')
    selected = list(members)
    for n in extra:
        found = [c for c in containers if name(c) == n]
        if len(found) != 1:
            raise RuntimeError(f'Configured controller/container is missing: {n}')
        if found[0] not in selected:
            selected.append(found[0])
    selected_ids = {c['Id'] for c in selected}
    for c in containers:
        if c['State']['Running'] and c['Id'] not in selected_ids:
            for m in c.get('Mounts', []):
                if m.get('RW') and any(overlaps(m['Source'], s) for s in sources):
                    raise RuntimeError(f'Unmanaged writer overlaps backup sources: {name(c)}')
    # Controllers first, clients next, object store then DB last. Reverse for restart.
    selected.sort(key=lambda c: (0 if name(c) in extra else 3 if c['Id'] == db['Id'] else
                                2 if provider and c['Id'] == provider['Id'] else 1, name(c)))
    # Physical data engines require clean shutdown. Suspending API/worker processes
    # quiesces their writes without relying on their process supervisor's stop behavior.
    data_engines = {db['Id']}
    data_engines.add(provider['Id'] if provider else storage['Id'])
    lifecycle = {c['Id']: ('pause' if c['Id'] not in data_engines and
                         (name(c) in frozen or stateless_supabase_image(c['Config']['Image'])) else 'stop')
                 for c in selected}
    return {'members': members, 'stop_order': selected, 'sources': sources,
            'db_dir': db_dir, 'storage_backend': backend, 'lifecycle': lifecycle,
            'data_engine_ids': sorted(data_engines)}


class Service:
    def __init__(self, config):
        self.c = config
        retention = config.get('retention_days', 30)
        if isinstance(retention, bool) or not isinstance(retention, int) or not 1 <= retention <= 365:
            raise ValueError('retention_days must be an integer between 1 and 365')
        self.state = Path(config.get('state_dir', '/var/lib/homeserver-backup'))
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.journal = self.state / 'recovery.json'
        self.status_file = self.state / 'status.json'
        self.repo = Path(config['mount']) / 'restic'
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', config['name']):
            raise ValueError('name must contain only letters, digits, dot, underscore, or hyphen')

    @contextlib.contextmanager
    def lock(self):
        with (self.state / 'operation.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError('Another backup operation is running') from None
            yield

    def disk(self):
        mount = Path(self.c['mount']).resolve()
        d = json.loads(run(['findmnt', '--json', '--target', str(mount), '--output', 'TARGET,UUID,FSTYPE,OPTIONS']))['filesystems'][0]
        if Path(d['target']).resolve() != mount or d.get('uuid') != self.c['disk_uuid']:
            raise RuntimeError('Backup disk missing or UUID mismatch; refusing root-filesystem fallback')
        if d['fstype'] != 'ext4' or 'rw' not in d['options'].split(','):
            raise RuntimeError('Backup disk must be mounted read-write as ext4')
        if self.repo.is_symlink() or self.repo.resolve().parent != mount:
            raise RuntimeError('Repository must be directly on the configured backup mount')
        return shutil.disk_usage(mount)

    def restic(self, *args, timeout=None):
        # Avoid ambient repository/password overrides. No credentials in argv.
        return run(['restic', '--repo', str(self.repo), '--password-file', self.c['password_file'],
                    '--cache-dir', str(self.state / 'cache'), *args],
                   timeout=timeout or self.c.get('operation_timeout_seconds', 3600))

    def status(self, **fields):
        s = read_json(self.status_file, {})
        s.update(fields)
        atomic_json(self.status_file, s)
        return s

    def inspect_id(self, cid):
        return json.loads(run(['docker', 'inspect', cid]))[0]

    def recover(self):
        journal = read_json(self.journal)
        if not journal:
            return
        errors = []
        started = []
        for item in journal['restart_order']:
            try:
                c = self.inspect_id(item['id'])
                if c['State'].get('Paused'):
                    log('container_unpause', container=item['name'])
                    run(['docker', 'unpause', item['id']])
                if not c['State']['Running']:
                    log('container_start', container=item['name'])
                    run(['docker', 'start', item['id']])
                started.append(item)
            except Exception as e:
                errors.append(item['name'])
                log('container_recovery_failed', container=item['name'], error=str(e))
        # Start the entire stack before health polling to avoid dependency deadlocks.
        deadline = time.monotonic() + self.c.get('health_timeout_seconds', 180)
        pending = list(started)
        while pending:
            for item in pending[:]:
                try:
                    c = self.inspect_id(item['id'])
                    health = c['State'].get('Health', {}).get('Status')
                    if c['State']['Running'] and not c['State'].get('Paused') and (health is None or health == 'healthy'):
                        pending.remove(item)
                except Exception:
                    pass
            if not pending:
                break
            if time.monotonic() >= deadline:
                errors.extend(item['name'] for item in pending)
                break
            time.sleep(2)
        if errors:
            raise RuntimeError('Recovery incomplete: ' + ', '.join(errors))
        self.journal.unlink()
        log('containers_recovered')

    def ensure_no_destination_change(self):
        if (self.state / 'destination-request.json').exists():
            raise RuntimeError('Destination change is pending; complete or cancel it before backup operations.')

    def preflight(self):
        self.ensure_no_destination_change()
        free = self.disk().free
        if free < self.c.get('minimum_free_gib', 20) * 1024**3:
            raise RuntimeError('Backup disk below minimum free-space threshold')
        password = Path(self.c['password_file'])
        if not password.is_file() or password.stat().st_mode & 0o077:
            raise RuntimeError('Repository password file missing or permissions exceed 0600')
        if not (self.repo / 'config').is_file():
            raise RuntimeError('Repository not initialized; run init first')
        self.restic('cat', 'config')
        layout = discover(self.c, inspect_all())
        for source in layout['sources']:
            p = Path(source)
            if p.is_symlink() or not p.exists() or not p.is_absolute() or p.resolve() == Path('/') or overlaps(p, self.c['mount']):
                raise RuntimeError(f'Unsafe or missing backup source: {source}')
            if overlaps(p, self.state):
                raise RuntimeError('Sources cannot include service state/cache')
        for c in layout['stop_order']:
            if c['State'].get('Paused'):
                raise RuntimeError(f'Container is already paused before maintenance: {name(c)}')
            if c['State']['Running'] and c['State'].get('Health', {}).get('Status') in ('unhealthy', 'starting'):
                raise RuntimeError(f'Container is not healthy before maintenance: {name(c)}')
        db = Path(layout['db_dir'])
        if not (db / 'PG_VERSION').is_file():
            raise RuntimeError('PostgreSQL PG_VERSION missing')
        # External WAL/tablespaces must be captured and stopped too.
        for link in [db / 'pg_wal', *list((db / 'pg_tblspc').glob('*'))]:
            if link.is_symlink() and not any(source_covers(s, link.resolve()) for s in layout['sources']):
                raise RuntimeError(f'External PostgreSQL path is not protected: {link}')
        return layout

    def assert_cold(self, layout):
        current = inspect_all()
        expected = {c['Id'] for c in layout['members']}
        actual = {c['Id'] for c in current if labels(c).get('com.docker.compose.project') == self.c['project']}
        if expected != actual:
            raise RuntimeError('Supabase deployment changed during backup')
        selected_ids = {c['Id'] for c in layout['stop_order']}
        for c in current:
            frozen = layout['lifecycle'].get(c['Id']) == 'pause'
            if c['Id'] in selected_ids and c['State']['Running'] and not (frozen and c['State'].get('Paused')):
                raise RuntimeError('A protected container restarted or unfroze during capture')
            if c['State']['Running'] and not c['State'].get('Paused'):
                if any(m.get('RW') and any(overlaps(m['Source'], s) for s in layout['sources']) for m in c.get('Mounts', [])):
                    raise RuntimeError('A writer appeared during capture')
        self.disk()

    def init(self):
        self.disk()
        password = Path(self.c['password_file'])
        if not password.exists():
            import secrets
            password.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            fd = os.open(password, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as f:
                f.write(secrets.token_urlsafe(48) + '\n')
                f.flush()
                os.fsync(f.fileno())
        if not (self.repo / 'config').exists():
            self.restic('init')
        else:
            self.restic('cat', 'config')
        log('repository_ready', repository=str(self.repo))

    def backup(self):
        self.recover()
        if (self.state / 'restore-recovery.json').exists():
            from verify_restore import recover_verification
            recover_verification(self)
        layout = self.preflight()
        started = now()
        run_id = uuid.uuid4().hex
        running = [c for c in layout['stop_order'] if c['State']['Running']]
        self.status(state='capturing', last_attempt=started.isoformat(), error=None)
        manifest = self.state / 'manifest.json'
        atomic_json(manifest, {
            'version': VERSION, 'run_id': run_id, 'started': started.isoformat(),
            'method': 'cold-filesystem', 'project': self.c['project'],
            'sources': layout['sources'], 'pgdata': layout['db_dir'],
            'storage_backend': layout['storage_backend'],
            'capture_policy': {name(c): layout['lifecycle'][c['Id']] for c in layout['stop_order']},
            'containers': [{'name': name(c), 'image': c['Config']['Image'], 'image_id': c['Image'],
                            'service': labels(c).get('com.docker.compose.service'),
                            'mounts': c['Mounts'],
                            # Stored only in root-only local manifest and encrypted repository.
                            'runtime_config': {k: c['Config'].get(k) for k in
                                               ('Env', 'Entrypoint', 'Cmd', 'User', 'WorkingDir')},
                            'shm_size': c.get('HostConfig', {}).get('ShmSize', 67108864)}
                           for c in layout['members']],
            'image_digests': {c['Config']['Image']: json.loads(run(['docker', 'image', 'inspect', c['Image']]))[0].get('RepoDigests', [])
                             for c in layout['members']},
        })
        atomic_json(self.journal, {'run_id': run_id, 'restart_order': [
            {'id': c['Id'], 'name': name(c), 'mode': layout['lifecycle'][c['Id']]} for c in reversed(running)]})
        snapshot = None
        try:
            for c in running:
                if layout['lifecycle'][c['Id']] == 'pause':
                    log('container_pause', container=name(c))
                    run(['docker', 'pause', c['Id']])
                    if not self.inspect_id(c['Id'])['State'].get('Paused'):
                        raise RuntimeError(f'Container did not pause: {name(c)}')
                    continue
                log('container_stop', container=name(c))
                run(['docker', 'stop', '--time', '90', c['Id']], timeout=120)
                stopped = self.inspect_id(c['Id'])
                if stopped['State']['Running'] or stopped['State'].get('ExitCode') == 137:
                    raise RuntimeError(f'Container did not shut down cleanly: {name(c)}')
            self.assert_cold(layout)
            # No PostgreSQL postmaster may remain. Cold capture is not a live directory copy.
            if (Path(layout['db_dir']) / 'postmaster.pid').exists():
                raise RuntimeError('PostgreSQL postmaster.pid remains after shutdown')
            self.status(state='backing_up')
            out = self.restic('backup', '--json', '--host', self.c['name'],
                              '--tag', self.c['name'], '--tag', 'pending', '--tag', run_id,
                              '--', *layout['sources'], str(manifest))
            events = [json.loads(line) for line in out.splitlines() if line.strip()]
            summaries = [e for e in events if e.get('message_type') == 'summary']
            if len(summaries) != 1 or not summaries[0].get('snapshot_id'):
                raise RuntimeError('Restic did not return a completed snapshot ID')
            snapshot = summaries[0]['snapshot_id']
            self.assert_cold(layout)
            listing = self.restic('ls', '--json', snapshot, str(manifest))
            nodes = [json.loads(line) for line in listing.splitlines() if line.strip()]
            if not any(n.get('path') == str(manifest) and n.get('type') == 'file' for n in nodes):
                raise RuntimeError('Snapshot manifest is missing')
        finally:
            self.recover()
        # Do not advertise completion or delete history until sources are safely resumed.
        self.restic('tag', '--remove', 'pending', '--add', 'complete', snapshot)
        # tag rewrites snapshot IDs; select by unique run tag rather than the old ID.
        saved = json.loads(self.restic('snapshots', '--json', '--tag', f'{self.c["name"]},complete,{run_id}'))
        if len(saved) != 1:
            raise RuntimeError('Completed snapshot lookup failed')
        snapshot = saved[0]['id']
        self.status(state='ready', last_success=now().isoformat(), snapshot_id=snapshot,
                    duration_seconds=round((now() - started).total_seconds(), 2), error=None)
        log('backup_complete', snapshot=snapshot)

    def snapshots(self):
        return json.loads(self.restic('snapshots', '--json', '--host', self.c['name'],
                                      '--tag', f'{self.c["name"]},complete'))

    def maintenance(self):
        self.ensure_no_destination_change()
        self.disk()
        if self.journal.exists() or (self.state / 'restore-recovery.json').exists():
            raise RuntimeError('Recovery journal exists; recover containers/restore scratch before maintenance')
        snapshots = self.snapshots()
        if not snapshots:
            raise RuntimeError('No complete backups; refusing retention')
        latest = max(dt.datetime.fromisoformat(s['time'].replace('Z', '+00:00')) for s in snapshots)
        if (now() - latest).total_seconds() > 26 * 3600:
            raise RuntimeError('Latest backup is stale; preserving recovery history')
        self.restic('check')
        if read_json(self.status_file, {}).get('restore_error'):
            raise RuntimeError('Restore verification failed; retention is blocked')
        verified = read_json(self.state / 'restore-verified.json')
        if not verified or (now() - dt.datetime.fromisoformat(verified['time'])).days > 45:
            self.status(retention='blocked_until_restore_test')
            raise RuntimeError('Retention requires a verified database/file restore in the past 45 days')
        self.restic('forget', '--host', self.c['name'], '--tag', f'{self.c["name"]},complete',
                    '--group-by', 'host', '--keep-within', f'{self.c.get("retention_days", 30)}d')
        # Remove abandoned incomplete snapshots only after a newer complete backup exists.
        pending = json.loads(self.restic('snapshots', '--json', '--host', self.c['name'],
                                         '--tag', f'{self.c["name"]},pending'))
        for s in pending:
            stamp = dt.datetime.fromisoformat(s['time'].replace('Z', '+00:00'))
            if stamp < latest and (now() - stamp).days >= 2:
                self.restic('forget', s['id'])
        if now().weekday() == 6:
            # Four deterministic subsets rotate over four Sundays.
            part = (now().date().toordinal() // 7) % 4 + 1
            self.restic('check', f'--read-data-subset={part}/4')
            self.restic('prune')
        self.status(retention='ok', last_maintenance=now().isoformat(), maintenance_error=None)
        log('maintenance_complete')

    def acknowledge_restore(self, snapshot):
        matches = [s for s in self.snapshots() if s['id'] == snapshot]
        if len(matches) != 1:
            raise RuntimeError('Use a full completed snapshot ID from snapshots')
        atomic_json(self.state / 'restore-verified.json', {'snapshot_id': snapshot, 'time': now().isoformat(),
                                                         'verification': 'operator-attestation'})
        log('operator_restore_attestation_recorded', snapshot=snapshot)

    def health(self):
        self.disk()
        s = read_json(self.status_file, {})
        if self.journal.exists():
            raise RuntimeError('Unresolved container recovery journal')
        if (self.state / 'restore-recovery.json').exists():
            raise RuntimeError('Unresolved restore verification journal')
        if not s.get('last_success') or (now() - dt.datetime.fromisoformat(s['last_success'])).total_seconds() > 26 * 3600:
            raise RuntimeError('No successful backup in the last 26 hours')
        if s.get('maintenance_error') or s.get('restore_error'):
            raise RuntimeError('Backup maintenance or restore verification failed; inspect status')
        if s.get('state') == 'failed':
            raise RuntimeError('Most recent backup attempt failed')
        log('healthy', last_success=s['last_success'], snapshot=s.get('snapshot_id'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default=DEFAULT_CONFIG)
    parser.add_argument('action', choices=['init', 'preflight', 'backup', 'recover', 'maintenance', 'health', 'status', 'snapshots', 'acknowledge-restore'])
    parser.add_argument('--snapshot')
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('Run as root; source volumes and configuration contain secrets')
    os.umask(0o077)
    config_path = Path(args.config)
    if config_path.stat().st_uid != 0 or config_path.stat().st_mode & 0o022:
        parser.error('Configuration must be root-owned and not writable by group/other')
    service = Service(read_json(config_path))
    def interrupted(signum, frame):
        raise RuntimeError(f'Interrupted by signal {signum}')
    signal.signal(signal.SIGTERM, interrupted)
    try:
        with service.lock():
            if args.action == 'status':
                print(json.dumps(read_json(service.status_file, {}), indent=2))
            elif args.action == 'snapshots':
                service.disk()
                print(json.dumps(service.snapshots(), indent=2))
            elif args.action == 'preflight':
                d = service.preflight()
                log('preflight_ok', sources=d['sources'], containers=[name(c) for c in d['stop_order']])
            elif args.action == 'acknowledge-restore':
                service.disk()
                service.acknowledge_restore(args.snapshot)
            else:
                getattr(service, args.action)()
    except Exception as e:
        if args.action == 'backup':
            service.status(state='failed', error=str(e))
        if args.action == 'maintenance':
            service.status(maintenance_error=str(e))
        log('operation_failed', action=args.action, error=str(e))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
