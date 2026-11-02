#!/usr/bin/env python3
"""Restore and checksum every file, then boot a PostgreSQL clone without networking."""
import argparse
import http.client
import json
import os
import re
import signal
from pathlib import Path
import shutil
import socket
import sys
import time
import uuid

from backup_service import Service, atomic_json, read_json, run, log, supabase_image, now


class DockerSocket(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost', timeout=120)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


def create_clone(config, clone_name):
    """Send secrets through the Docker Unix socket, never command-line arguments."""
    conn = DockerSocket()
    try:
        conn.request('GET', '/version')
        response = conn.getresponse()
        version = json.loads(response.read())['ApiVersion']
        conn.request('POST', f'/v{version}/containers/create?name={clone_name}', json.dumps(config),
                     {'Content-Type': 'application/json'})
        response = conn.getresponse()
        body = response.read()
        if response.status != 201:
            raise RuntimeError(f'Docker clone creation failed: HTTP {response.status}')
        return json.loads(body)['Id']
    finally:
        conn.close()


def recover_verification(service):
    journal_path = service.state / 'restore-recovery.json'
    journal = read_json(journal_path)
    if not journal:
        return
    service.disk()
    destination = Path(journal['destination'])
    expected_parent = Path(service.c['mount']) / 'restore-check'
    if destination.parent.resolve() != expected_parent.resolve() or not re.fullmatch(r'[a-f0-9]{32}', destination.name):
        raise RuntimeError('Unsafe restore-recovery destination; refusing deletion')
    ids = run(['docker', 'ps', '-aq', '--filter', 'name=^/' + journal['clone_name'] + '$']).split()
    for cid in ids:
        info = json.loads(run(['docker', 'inspect', cid]))[0]
        if info['Config'].get('Labels', {}).get('io.homeserver-backup.restore') != journal['run_id']:
            raise RuntimeError('Restore clone identity mismatch')
        run(['docker', 'rm', '--force', cid])
    if destination.exists():
        if destination.is_symlink():
            raise RuntimeError('Restore recovery directory is a symlink')
        shutil.rmtree(destination)
    journal_path.unlink()
    log('restore_scratch_recovered')


def verify(service, snapshot=None):
    service.ensure_no_destination_change()
    recover_verification(service)
    service.disk()
    if service.journal.exists():
        raise RuntimeError('Resolve interrupted backup recovery first')
    snapshots = service.snapshots()
    if snapshot:
        snapshots = [s for s in snapshots if s['id'] == snapshot]
    if not snapshots:
        raise RuntimeError('No matching completed snapshot')
    chosen = max(snapshots, key=lambda s: s['time'])
    snapshot = chosen['id']
    # Never restore into live volumes. Everything is placed under a new isolated directory.
    run_id = uuid.uuid4().hex
    destination = Path(service.c['mount']) / 'restore-check' / run_id
    clone_name = 'homeserver-backup-restore-' + run_id
    atomic_json(service.state / 'restore-recovery.json', {
        'destination': str(destination), 'clone_name': clone_name, 'run_id': run_id})
    destination.mkdir(mode=0o700, parents=True)
    clone = None
    try:
        stats = json.loads(service.restic('stats', '--json', '--mode', 'restore-size', snapshot))
        if service.disk().free < int(stats['total_size']) + 5 * 1024**3:
            raise RuntimeError('Insufficient backup-disk space for isolated full restore')
        service.restic('restore', '--verify', '--target', str(destination), snapshot)
        manifest_path = destination / str(service.state / 'manifest.json').lstrip('/')
        manifest = read_json(manifest_path)
        if not manifest or manifest.get('method') != 'cold-filesystem':
            raise RuntimeError('Restore manifest missing or unsupported')
        dbs = [c for c in manifest['containers'] if supabase_image(c['image'], 'postgres')]
        if len(dbs) != 1:
            raise RuntimeError('Restore manifest does not identify one database')
        db = dbs[0]
        binds = []
        for m in db['mounts']:
            original = Path(m['Source'])
            restored = destination / str(original).lstrip('/')
            if not restored.exists() or not restored.resolve().is_relative_to(destination.resolve()):
                raise RuntimeError('Database restore mount missing or escapes sandbox')
            binds.append({'Type': 'bind', 'Source': str(restored), 'Target': m['Destination'],
                          'ReadOnly': not m['RW']})
        config = {k: v for k, v in db['runtime_config'].items() if v is not None}
        config.update({'Image': db['image_id'], 'NetworkDisabled': True,
                       'Labels': {'io.homeserver-backup.restore': run_id},
                       'HostConfig': {'NetworkMode': 'none', 'RestartPolicy': {'Name': 'no'},
                                      'Mounts': binds, 'ShmSize': db.get('shm_size', 67108864),
                                      'LogConfig': {'Type': 'none'}}})
        clone = create_clone(config, clone_name)
        run(['docker', 'start', clone])
        deadline = time.monotonic() + 180
        last_error = None
        # Original runtime env stays inside the clone. The shell expands the password there.
        query = ('export PGPASSWORD="$POSTGRES_PASSWORD"; '
                 'exec psql -X --no-password -h 127.0.0.1 -U postgres -d postgres '
                 '-v ON_ERROR_STOP=1 -At -c ' +
                 "\"SELECT json_build_object('databases', (SELECT count(*) FROM pg_database), "
                 "'auth_users', (SELECT count(*) FROM auth.users), "
                 "'storage_objects', (SELECT count(*) FROM storage.objects), "
                 "'storage_buckets', (SELECT count(*) FROM storage.buckets));\"")
        while time.monotonic() < deadline:
            try:
                counts = json.loads(run(['docker', 'exec', clone, 'sh', '-c', query], timeout=20).strip())
                break
            except Exception as e:
                last_error = e
                time.sleep(3)
        else:
            raise RuntimeError(f'Restored database failed SQL validation: {last_error}')
        report = {'snapshot_id': snapshot, 'file_checksum_restore': True,
                  'postgres_clone_sql': counts, 'network': 'none',
                  'storage_api_download_test': 'not performed',
                  'note': 'Object bytes were fully restored and verified; authenticated Storage API behavior requires an operator drill.'}
        atomic_json(service.state / 'restore-report.json', report)
        atomic_json(service.state / 'restore-verified.json', {
            'snapshot_id': snapshot, 'time': now().isoformat(),
            'verification': 'automated-full-file-restore-and-postgres-sql',
            'storage_api_download_test': 'not performed'})
        service.status(restore_error=None, last_restore_verification=now().isoformat())
        log('restore_verification_passed', snapshot=snapshot, counts=counts)
        return report
    finally:
        recover_verification(service)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config', default='/etc/homeserver-backup/config.json')
    p.add_argument('--snapshot')
    p.add_argument('--recover', action='store_true')
    a = p.parse_args()
    if os.geteuid() != 0:
        p.error('Run with sudo')
    os.umask(0o077)
    s = Service(read_json(a.config))
    def interrupted(signum, frame):
        raise RuntimeError(f'Restore verification interrupted by signal {signum}')
    signal.signal(signal.SIGTERM, interrupted)
    try:
        with s.lock():
            if a.recover:
                interrupted_job = (s.state / 'restore-recovery.json').exists()
                recover_verification(s)
                if interrupted_job:
                    s.status(restore_error='Previous restore verification was interrupted; rerun verification')
            else:
                print(json.dumps(verify(s, a.snapshot), indent=2))
    except Exception as e:
        s.status(restore_error=str(e))
        log('restore_verification_failed', error=str(e))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
