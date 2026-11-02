# Server backups in Homebase

The **Backups → Database + Storage** tab manages coordinated Supabase recovery points. **Coolify database schedules** remains available for Coolify's database-only backups.

## Connect this server's existing backups

1. Deploy this version of Homebase.
2. Open **Backups → Database + Storage** and select the server.
3. Choose **Connect existing backups**. Homebase finds the existing mount and Supabase project from the host configuration and upgrades the bundled management agent.

Existing snapshots, repository password, disk UUID, and enabled schedules are preserved. Connecting does not run a backup or format a disk. The administrator's existing Coolify connection supplies the SSH identity; the API token needs `read:sensitive` to retrieve the server key. Root access, or passwordless sudo for the Python installer and control entrypoint, is required. Docker-only sudo permission is insufficient.

## First setup on another server

Prepare a dedicated ext4 filesystem and mount it read-write, for example at `/srv/backups`. Homebase deliberately has no formatting endpoint.

Select the server, enter the mounted destination and optional Supabase Compose project ID, and choose **Install backup service**. A single Supabase deployment is detected automatically; multiple deployments require an explicit project ID. The bundled installer installs Restic if necessary. Python 3.10+, Docker, systemd, and a Debian/Ubuntu host are required for automatic package installation. Other Linux hosts can preinstall Restic before using the installer.

Then:

1. Choose **Run backup**. This temporarily pauses APIs/workers and cleanly stops PostgreSQL and RustFS/MinIO. The durable recovery journal resumes them after capture or failure.
2. Choose **Verify latest restore**. This restores all files with checksum verification and starts an isolated PostgreSQL clone with no network access or published ports.
3. Open **Configure**, set daily time, timezone, retention days and free-space threshold, then enable nightly backups. Enabling a previously disabled schedule requires a recent successful backup and restore verification.

The agent supports local-file Storage or a RustFS/MinIO container in the same Supabase Compose project. External S3 backends are rejected because their object bytes need a separate capture strategy. Each host service instance protects one Supabase project.

Keep `/etc/homeserver-backup/repository-password` in a password manager independently of the server. Homebase never sends this password or the captured runtime environment to the browser.

## Reading the page

- **Backup health** reports stale or failed captures, unavailable/wrong disks, interrupted recovery, missing or stale restore tests, and running jobs. A backup older than 26 hours needs attention.
- **Next nightly backup** comes from systemd. Time and timezone settings are applied to host timer overrides, not a browser scheduler.
- **Backup disk** reports only the configured filesystem after verifying its UUID. The page never substitutes the server root filesystem's free space when the disk is missing.
- **Snapshots** shows completed and incomplete snapshots, capture time, IDs, protected bytes, added bytes, and file counts when Restic reports them. An unreadable history produces an explicit warning, not a successful empty list.
- **Restore verification** identifies the exact tested snapshot. A newer backup does not inherit the older snapshot's verified badge. File checksums and PostgreSQL startup/SQL checks do not test authenticated Storage API downloads or every application workflow.
- **Recent activity** shows structured agent events from the installed backup, verification, and maintenance units.

The page polls the host while open. Backup execution, hourly health checks, retention maintenance, and monthly restore verification continue through systemd when Homebase is closed or unavailable. No external notification channel is configured by this feature.

## Change the destination after setup

In **Backups → Database + Storage**, find **Backup disk → Change backup destination**. Enter the new mount path, such as `/mnt/backup-disk`, and choose:

- **Copy existing backups** copies the complete encrypted repository, verifies all stored data packs and matching snapshot IDs, then switches the active destination. Existing snapshot IDs and restore evidence remain valid.
- **Start a new repository** creates and checks an empty repository, then switches the active destination. Previous backups stay on the old disk. Run a backup and verify its restore on the new disk before relying on it.

The target must be a different ext4 filesystem already mounted read-write, with no existing `restic` directory. Mount it persistently on the host before using it. The agent rejects root-filesystem destinations, symlinks, overlapping source paths, wrong disk UUIDs, and insufficient space. Homebase never formats a disk. Both options preserve the old repository, repository password, schedule, and retention settings. The current history view shows only the active repository.

This runs as a background systemd job and can take hours for a large repository. Backup, verification, and maintenance operations are blocked by a durable pending journal during the change. The page displays the target and progress state. If the job fails, choose **Retry destination change** or **Cancel destination change**. Retrying resumes safely after a crash, including a failure after configuration switched. Cancellation is allowed only before the active destination switches; copied staging files remain on the new disk. No old repository or staged copy is deleted by cancellation. If the destination has already switched, retry finalization.

Older agents must be upgraded with **Update agent** before they accept destination controls. The bundled agent is version 1.2.0.

## Configuration and retention

Configuration accepts daily start time, IANA timezone, 1–365 retention days, free-space threshold, and nightly enable/disable. The default recovery window is 30 days. It does not accept arbitrary commands, source paths, password paths, or disk-format requests.

Configuration changes are serialized against other controls and active backup operations. Failed updates attempt to restore configuration, timer overrides, and previous enabled/active states. Timer jobs start after releasing the backup operation lock so they can acquire it themselves. Enabling scheduling also enables health, maintenance, and monthly verification timers. Persistent maintenance and verification jobs are ordered after backup jobs to avoid overlapping catch-up runs.

Retention deletion requires a recent successful backup and a restore test within 45 days. The window is relative to the latest snapshot; outages preserve existing history. Physical disk reclamation happens during weekly pruning. Generic filesystem-age deletion must never be applied to a deduplicated Restic repository.

Live database restoration and snapshot deletion are intentionally absent from this view. Restore into an isolated location and validate the complete stack before replacing production.

## Packaging and controls

`backup-agent/` contains the backup engine, installer, restore verifier, restricted JSON controller, systemd units, and agent tests. The Docker image includes this directory explicitly. Homebase transfers a fixed, checksummed bundle over the authenticated SSH connection; browser input cannot provide script contents or arbitrary remote commands. No additional HTTP daemon or public server port is installed.

Installed paths remain compatible with the standalone service:

- `/opt/homeserver-backup/` for code.
- `/etc/homeserver-backup/` for root-owned settings and repository password.
- `/var/lib/homeserver-backup/` for operation state and recovery journals.
- `<mounted backup disk>/restic` for encrypted snapshots.

For a Node deployment, retain `backup-agent/` alongside the app. A Next.js standalone deployment must also include it; the provided Dockerfile does this automatically. Host controls are authenticated, same-origin POST operations and use the app's administrator rate limit. Demo mode uses an explicitly labeled in-memory simulation and never falls back from a failed live connection to demonstration snapshots.

Development checks:

```sh
npm run typecheck
npm test
npm run test:backup-agent
npm run build
```
