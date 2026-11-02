#!/usr/bin/env python3
"""Opt-in real cold PostgreSQL backup and isolated-clone restore test."""
import json
import os
from pathlib import Path
import shutil
import socket
import sys
import tempfile
import time
import uuid
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backup_service as b
import verify_restore as v


def main():
    image = os.environ.get('POSTGRES_TEST_IMAGE', 'public.ecr.aws/supabase/postgres:17.11.0.002')
    storage_image = os.environ.get('STORAGE_TEST_IMAGE', 'public.ecr.aws/supabase/storage-api:v1.79.28')
    restic = os.environ['RESTIC_TEST_BIN']
    project = 'backup-integration-' + uuid.uuid4().hex[:10]
    created = []
    aliases = []
    trace = []
    real_run = b.run
    def command(args, **kwargs):
        trace.append(list(args))
        if args[0] == 'restic':
            args = [restic, *args[1:]]
        return real_run(args, **kwargs)
    with tempfile.TemporaryDirectory(prefix='backup-integration-', dir='/private/tmp') as temp:
        root = Path(temp)
        pgdata = root / 'pgdata'
        objects = root / 'objects'
        pgdata.mkdir(mode=0o777)
        os.chmod(pgdata, 0o777)
        objects.mkdir()
        os.chmod(objects, 0o777)
        (objects / 'example.bin').write_bytes(os.urandom(4096))
        repo_mount = root / 'backup-disk'
        repo_mount.mkdir()
        try:
            command(['docker', 'run', '--rm', '--network', 'none', '--user', 'postgres',
                     '--mount', f'type=bind,source={pgdata},target=/pgdata',
                     '--entrypoint', '/nix/var/nix/profiles/default/bin/initdb', image,
                     '-D', '/pgdata', '-U', 'postgres', '--auth=trust', '--no-locale'])
            db = command(['docker', 'run', '-d', '--network', 'none', '--user', 'postgres',
                          '--label', f'com.docker.compose.project={project}',
                          '--label', 'com.docker.compose.service=db',
                          '-e', 'PGDATA=/var/lib/postgresql/data', '-e', 'POSTGRES_PASSWORD=fixture-only',
                          '--mount', f'type=bind,source={pgdata},target=/var/lib/postgresql/data',
                          '--entrypoint', '/nix/var/nix/profiles/default/bin/postgres', image,
                          '-D', '/var/lib/postgresql/data', '-c', 'listen_addresses=127.0.0.1',
                          '-c', 'unix_socket_directories=/tmp']).strip()
            created.append(db)
            for _ in range(60):
                try:
                    command(['docker', 'exec', db, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'])
                    break
                except RuntimeError:
                    time.sleep(1)
            else:
                raise RuntimeError('Test PostgreSQL did not start')
            sql = ('CREATE SCHEMA auth; CREATE TABLE auth.users (id int); INSERT INTO auth.users VALUES(1); '
                   'CREATE SCHEMA storage; CREATE TABLE storage.objects (id int); INSERT INTO storage.objects VALUES(1); '
                   'CREATE TABLE storage.buckets(id int); INSERT INTO storage.buckets VALUES(1);')
            command(['docker', 'exec', db, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql])
            storage = command(['docker', 'create', '--network', 'none',
                               '--label', f'com.docker.compose.project={project}',
                               '--label', 'com.docker.compose.service=storage',
                               '-e', 'STORAGE_BACKEND=file',
                               '--mount', f'type=bind,source={objects},target=/var/lib/storage', storage_image]).strip()
            created.append(storage)
            controller_name = project + '-controller'
            controller = command(['docker', 'run', '-d', '--network', 'none', '--no-healthcheck', '--name', controller_name,
                                  '--mount', f'type=bind,source={objects},target=/config',
                                  '--entrypoint', 'sh', image, '-c', 'while :; do sleep 1; done']).strip()
            created.append(controller)
            analytics_image = 'supabase/logflare:' + project
            command(['docker', 'tag', image, analytics_image])
            aliases.append(analytics_image)
            analytics = command(['docker', 'run', '-d', '--network', 'none', '--no-healthcheck',
                                 '--label', f'com.docker.compose.project={project}',
                                 '--label', 'com.docker.compose.service=analytics',
                                 '--mount', f'type=bind,source={objects},target=/logs',
                                 '--entrypoint', 'sh', analytics_image, '-c',
                                 'trap "" TERM INT; while :; do echo event >> /logs/events; sleep 0.05; done']).strip()
            created.append(analytics)
            config = {'name': project, 'project': project, 'mount': str(repo_mount),
                      'disk_uuid': 'test-only', 'state_dir': str(root / 'state'),
                      'password_file': str(root / 'password'), 'minimum_free_gib': 1,
                      'quiesce_containers': [controller_name], 'freeze_containers': [controller_name]}
            service = b.Service(config)
            uri = command(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).strip()
            def connect(conn):
                conn.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                conn.sock.settimeout(conn.timeout)
                conn.sock.connect(uri.removeprefix('unix://'))
            with patch.object(b, 'run', side_effect=command), patch.object(service, 'disk', side_effect=lambda: shutil.disk_usage(repo_mount)), \
                 patch.object(v.DockerSocket, 'connect', connect):
                service.init()
                service.backup()
                assert ['docker', 'pause', analytics] in trace, trace
                assert not any(args[:2] == ['docker', 'stop'] and args[-1] == analytics for args in trace), trace
                analytics_state = json.loads(command(['docker', 'inspect', analytics]))[0]['State']
                assert analytics_state['Running'] and not analytics_state['Paused'], analytics_state
                controller_state = json.loads(command(['docker', 'inspect', controller]))[0]['State']
                assert controller_state['Running'] and not controller_state['Paused'], controller_state
                report = v.verify(service)
                assert report['postgres_clone_sql']['auth_users'] == 1, report
                assert report['postgres_clone_sql']['storage_objects'] == 1, report
                assert report['postgres_clone_sql']['storage_buckets'] == 1, report
                service.health()
                print(json.dumps({'result': 'PASS', 'postgres_image': image, 'report': report, 'capture_modes_verified': {'analytics': 'pause', 'controller': 'pause', 'postgres': 'stop'}}, indent=2))
        finally:
            for cid in reversed(created):
                command(['docker', 'rm', '--force', cid])
            for alias in aliases:
                command(['docker', 'image', 'rm', alias])


if __name__ == '__main__':
    main()
