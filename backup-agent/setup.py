#!/usr/bin/env python3
"""Portable installer. Formatting is a separate, explicitly selected command."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

from backup_service import Service, atomic_json, discover, inspect_all, read_json, run, supabase_image

BASE = Path(__file__).resolve().parent
ETC = Path('/etc/homeserver-backup')
PREFIX = Path('/opt/homeserver-backup')


def block_info(device):
    info = json.loads(run(['lsblk', '--json', '--bytes', '--paths', '--nodeps', '--output',
                           'NAME,TYPE,SIZE,FSTYPE,LABEL,UUID,PARTUUID,PKNAME,MOUNTPOINTS', device]))['blockdevices'][0]
    # Probe the device directly; udev/lsblk filesystem values may be stale after mkfs.
    probe = dict(line.split('=', 1) for line in run(['blkid', '--probe', '--output', 'export', device]).splitlines() if '=' in line)
    info.update(uuid=probe.get('UUID'), fstype=probe.get('TYPE'), label=probe.get('LABEL'))
    return info


def resolve_uuid(value):
    return str(Path(run(['blkid', '-U', value]).strip()).resolve())


def prepare_disk(args):
    """Journal partition identity before erase; never repartition the parent disk."""
    ETC.mkdir(mode=0o700, exist_ok=True)
    journal = ETC / 'disk-preparation.json'
    saved = read_json(journal)
    if saved:
        if saved['erase_uuid'] != args.erase_uuid or saved['preserve_uuid'] != args.preserve_uuid or saved['mount'] != args.mount:
            raise RuntimeError('Existing disk preparation uses different identities or mount path')
        partition = f'/dev/disk/by-partuuid/{saved["partuuid"]}'
        if not Path(partition).exists():
            raise RuntimeError('Previously selected partition is absent')
        device = str(Path(partition).resolve())
    else:
        device = resolve_uuid(args.erase_uuid)
    keep = resolve_uuid(args.preserve_uuid)
    disk, other = block_info(device), block_info(keep)
    if disk['type'] != 'part' or other['type'] != 'part' or device == keep or disk['pkname'] != other['pkname']:
        raise RuntimeError('Erase and preserve UUIDs must identify distinct partitions on the same disk')
    if disk['fstype'] not in ('hfsplus', 'ntfs', 'exfat', 'ext4', 'vfat'):
        raise RuntimeError('Unsupported source filesystem; refusing swap/LVM/RAID members')
    if any(p in ('/', '/boot', '/boot/efi') for p in disk.get('mountpoints', []) if p):
        raise RuntimeError('Refusing a system partition')
    if not disk['partuuid'] or not disk['pkname']:
        raise RuntimeError('Partition requires stable PARTUUID and parent disk identity')
    if saved and (disk['size'] != saved['bytes'] or disk['partuuid'] != saved['partuuid']):
        raise RuntimeError('Partition identity/size changed since preparation started')
    mount = Path(args.mount)
    if not mount.is_absolute() or str(mount) in ('/', '/boot', '/boot/efi', '/home', '/data') or any(c.isspace() for c in str(mount)) or mount.is_symlink():
        raise RuntimeError('Unsafe mount path')
    target_uuid = subprocess.run(['findmnt', '--mountpoint', str(mount), '--noheadings', '--output', 'UUID'],
                                 text=True, stdout=subprocess.PIPE).stdout.strip()
    if target_uuid and target_uuid != disk['uuid']:
        raise RuntimeError('Mount path already belongs to another filesystem')
    if not target_uuid and mount.exists() and any(mount.iterdir()):
        raise RuntimeError('Mount directory is not empty')
    for line in Path('/etc/fstab').read_text().splitlines():
        fields = line.split()
        if not fields or line.lstrip().startswith('#'):
            continue
        if fields[0] == f'UUID={args.erase_uuid}':
            raise RuntimeError('Original filesystem has an fstab entry; remove/review it before formatting')
        if len(fields) > 1 and fields[1] == str(mount) and fields[0] != f'UUID={disk["uuid"]}':
            raise RuntimeError('Conflicting mount in fstab; refusing to format')
    if not saved:
        if disk['uuid'] != args.erase_uuid:
            raise RuntimeError('Filesystem identity changed')
        saved = {'erase_uuid': args.erase_uuid, 'preserve_uuid': args.preserve_uuid,
                 'partuuid': disk['partuuid'], 'bytes': disk['size'], 'mount': str(mount)}
        atomic_json(journal, saved)
    existing_mounts = [p for p in disk.get('mountpoints', []) if p]
    if disk['fstype'] != 'ext4' or disk['label'] != 'HOMEBACKUP':
        # Only the original authorized filesystem may be erased on retry.
        if disk['uuid'] != args.erase_uuid:
            raise RuntimeError('Unexpected filesystem; refusing to format')
        for point in existing_mounts:
            if point in ('/', '/boot', '/boot/efi'):
                raise RuntimeError('Refusing a system partition')
            run(['umount', point])
        print(f'Formatting only {device}, PARTUUID {disk["partuuid"]}, {disk["size"]} bytes as ext4', flush=True)
        run(['mkfs.ext4', '-F', '-L', 'HOMEBACKUP', '-m', '1', device], timeout=300)
        disk = block_info(device)
    new_uuid = disk['uuid']
    if not new_uuid:
        raise RuntimeError('Formatted filesystem has no UUID')
    # Never write a repository into an existing directory hidden beneath a mount.
    existing = subprocess.run(['findmnt', '--mountpoint', str(mount), '--noheadings', '--output', 'UUID'],
                              text=True, stdout=subprocess.PIPE).stdout.strip()
    if existing and existing != new_uuid:
        raise RuntimeError('Mount path belongs to another filesystem')
    if not existing and mount.exists() and any(mount.iterdir()):
        raise RuntimeError('Mount directory is not empty')
    mount.mkdir(mode=0o700, parents=True, exist_ok=True)
    fstab = Path('/etc/fstab')
    lines = fstab.read_text().splitlines()
    matching = [line for line in lines if line.strip() and not line.lstrip().startswith('#') and
                (line.split()[0] in (f'UUID={new_uuid}', f'UUID={args.erase_uuid}') or
                 len(line.split()) > 1 and line.split()[1] == str(mount))]
    desired = f'UUID={new_uuid} {mount} ext4 defaults,nofail,nodev,nosuid,noexec,x-systemd.device-timeout=15s 0 2'
    if any(line != desired for line in matching):
        raise RuntimeError('Conflicting fstab entry; review it before proceeding')
    if desired not in lines:
        backup = ETC / 'fstab.before-backup-service'
        if not backup.exists():
            shutil.copy2(fstab, backup)
        temp = fstab.with_name('fstab.homeserver-backup.tmp')
        temp.write_text('\n'.join(lines) + '\n' + desired + '\n')
        os.chmod(temp, 0o644)
        os.replace(temp, fstab)
    run(['systemctl', 'daemon-reload'])
    if not existing:
        run(['mount', str(mount)])
    os.chmod(mount, 0o700)
    if resolve_uuid(args.preserve_uuid) != keep or block_info(keep)['uuid'] != args.preserve_uuid:
        raise RuntimeError('Preserved partition verification failed')
    saved['formatted_uuid'] = new_uuid
    atomic_json(journal, saved)
    print(json.dumps({'mount': str(mount), 'uuid': new_uuid, 'preserved_uuid': args.preserve_uuid}, indent=2))


def install(args):
    for binary in ['docker', 'restic', 'findmnt', 'systemctl']:
        if not shutil.which(binary):
            raise RuntimeError(f'Missing dependency: {binary}. On Ubuntu install restic with apt-get install restic')
    if any(c.isspace() for c in args.mount) or Path(args.mount).is_symlink():
        raise RuntimeError('Mount path must not contain whitespace or be a symlink')
    if '\n' in args.timezone or '\r' in args.timezone or not (Path('/usr/share/zoneinfo') / args.timezone).is_file():
        raise RuntimeError('Unknown timezone')
    containers = inspect_all()
    projects = {c['Config'].get('Labels', {}).get('com.docker.compose.project') for c in containers
                if supabase_image(c['Config']['Image'], 'postgres')}
    projects.discard(None)
    project = args.project
    if not project:
        if len(projects) != 1:
            raise RuntimeError('Select --project explicitly; multiple/no Supabase deployments detected')
        project = next(iter(projects))
    mount = json.loads(run(['findmnt', '--json', '--mountpoint', args.mount, '--output', 'TARGET,UUID,FSTYPE,OPTIONS']))['filesystems'][0]
    if mount['fstype'] != 'ext4' or 'rw' not in mount['options'].split(','):
        raise RuntimeError('Destination must already be mounted read-write as ext4; installer never formats')
    ETC.mkdir(mode=0o700, exist_ok=True)
    PREFIX.mkdir(mode=0o755, exist_ok=True)
    config_path = ETC / 'config.json'
    proposed = {
        'name': args.name, 'project': project, 'mount': str(Path(args.mount).resolve()),
        'disk_uuid': mount['uuid'], 'password_file': str(ETC / 'repository-password'),
        'state_dir': '/var/lib/homeserver-backup', 'minimum_free_gib': 20,
        'operation_timeout_seconds': 3600, 'health_timeout_seconds': 180, 'retention_days': 30,
        'quiesce_containers': ['coolify'] if any(c['Name'] == '/coolify' for c in containers) else [],
        'extra_sources': [str(ETC), str(PREFIX)],
    }
    if config_path.exists():
        config = read_json(config_path)
        if any(config[k] != proposed[k] for k in ('name', 'project', 'mount', 'disk_uuid')):
            raise RuntimeError('Existing installation targets different sources/disk; review config rather than overwriting')
    else:
        config = proposed
    # Migrate controller handling without changing database shutdown requirements.
    config.setdefault('retention_days', 30)
    config.setdefault('freeze_containers', [n for n in config.get('quiesce_containers', []) if n == 'coolify'])
    discover(config, containers)  # Validate supported source layout before installation.
    service = Service(config)
    with service.lock():
        service.ensure_no_destination_change()
        for file in ['backup_service.py', 'verify_restore.py', 'control.py', 'destination.py']:
            shutil.copy2(BASE / file, PREFIX / file)
            os.chmod(PREFIX / file, 0o644)
        atomic_json(config_path, config)
        wrapper = Path('/usr/local/sbin/homeserver-backup')
        wrapper.write_text('#!/bin/sh\nexec /usr/bin/python3 /opt/homeserver-backup/backup_service.py "$@"\n')
        os.chmod(wrapper, 0o755)
        for file in (BASE / 'systemd').glob('homeserver-backup*'):
            data = file.read_text().replace('@MOUNT@', config['mount']).replace('Asia/Kathmandu', args.timezone)
            unit_path = Path('/etc/systemd/system') / file.name
            unit_path.write_text(data)
            os.chmod(unit_path, 0o644)
        service.init()
        layout = service.preflight()
    run(['systemctl', 'daemon-reload'])
    units = [p.name for p in (BASE / 'systemd').glob('*.service')] + [p.name for p in (BASE / 'systemd').glob('*.timer')]
    run(['systemd-analyze', 'verify', *[f'/etc/systemd/system/{u}' for u in units]])
    run(['systemctl', 'enable', 'homeserver-backup-recover.service'])
    if args.run_first_backup:
        from verify_restore import verify
        with service.lock():
            service.backup()
            verify(service)
            service.maintenance()
            service.health()
    if args.enable:
        run(['systemctl', 'enable', '--now', 'homeserver-backup.timer', 'homeserver-backup-maintenance.timer', 'homeserver-backup-health.timer', 'homeserver-backup-verify.timer'])
    print(json.dumps({'installed': True, 'timers_enabled': args.enable, 'project': project,
                      'sources': layout['sources'], 'quiesced_containers': [c['Name'] for c in layout['stop_order']],
                      'frozen_controllers': config.get('freeze_containers', []),
                      'capture_policy': {c['Name']: layout['lifecycle'][c['Id']] for c in layout['stop_order']},
                      'next': 'Inspect homeserver-backup status and systemctl list-timers homeserver-backup*.' if args.run_first_backup else 'Run homeserver-backup backup and verify_restore.py.'}, indent=2))


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run with sudo')
    os.umask(0o077)
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='action', required=True)
    disk = sub.add_parser('prepare-disk', help='ERASE exactly the filesystem identified by --erase-uuid')
    disk.add_argument('--erase-uuid', required=True)
    disk.add_argument('--preserve-uuid', required=True)
    disk.add_argument('--mount', default='/srv/backups')
    ins = sub.add_parser('install', help='Install service onto an existing ext4 mount; never formats')
    ins.add_argument('--mount', default='/srv/backups')
    ins.add_argument('--project')
    ins.add_argument('--name', default='supabase')
    ins.add_argument('--enable', action='store_true', help='Enable scheduled timers after preflight')
    ins.add_argument('--run-first-backup', action='store_true', help='Perform maintenance-window backup and isolated restore before enabling timers')
    ins.add_argument('--timezone', default='Asia/Kathmandu')
    args = p.parse_args()
    try:
        prepare_disk(args) if args.action == 'prepare-disk' else install(args)
    except Exception as e:
        print(f'Setup failed: {e}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
