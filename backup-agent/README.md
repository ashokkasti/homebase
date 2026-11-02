# Homebase backup agent

This directory is the host runtime bundled with Homebase. See [setup and controls](../docs/server-backups.md).

The installer is invoked by Homebase over its existing privileged SSH connection. It accepts an already-mounted ext4 filesystem, records its UUID, and preserves an existing installation's configuration and snapshots. It does not format disks when called through Homebase.

For headless setup:

```sh
sudo python3 setup.py install --mount /srv/backups --run-first-backup --enable
```

`control.py` accepts one JSON request on standard input for overview, logs, backup/verification/maintenance triggers, or validated settings. It is not a network service. Runtime configuration and captured environment values must never be exposed by its overview or log responses.

Run agent tests from this directory with `python3 -m unittest discover -s tests -v`. Set `RESTIC_TEST_BIN` to enable the real Restic test. The opt-in PostgreSQL integration requires local Docker and the test images documented in its script.
