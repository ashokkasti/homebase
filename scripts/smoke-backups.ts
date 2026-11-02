import assert from "node:assert/strict";
import {
  backupOverviewSchema,
  backupEventsSchema,
  scheduleSchema,
} from "../lib/backup-schemas";
import { dashboardSchema } from "../lib/schemas";
const base = process.argv[2] || "http://127.0.0.1:3107";
const origin = new URL(base).origin;
async function request(path: string, body?: unknown, source = origin) {
  return fetch(`${base}/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? undefined
        : { "Content-Type": "application/json", Origin: source },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function main() {
  const dashboard = dashboardSchema.parse(
    await (await request("dashboard")).json(),
  );
  assert.equal(
    dashboard.demo,
    true,
    "This test may mutate only an explicit demo workspace.",
  );
  const server = dashboard.servers[0];
  assert.ok(server);
  const path = `server-backups/${server.id}`;
  async function overview() {
    return backupOverviewSchema.parse(await (await request(path)).json());
  }
  const initial = await overview();
  assert.equal(initial.kind, "ready");
  if (initial.kind !== "ready") return;
  const previous = scheduleSchema.parse({
    time: initial.settings.time,
    timezone: initial.settings.timezone,
    retentionDays: initial.settings.retentionDays,
    minimumFreeGiB: initial.settings.minimumFreeGiB,
    enabled: initial.settings.enabled,
  });
  assert.equal(
    (await request(path, { action: "backup" }, "https://invalid.test")).status,
    400,
  );
  assert.equal((await request(path, { action: "delete" })).status, 400);
  assert.equal(
    (
      await request(path, {
        action: "configure",
        settings: { ...previous, time: "02:00\nExecStart=sh" },
      })
    ).status,
    400,
  );
  const settings = {
    ...previous,
    time: "03:15",
    retentionDays: 14,
    enabled: false,
  };
  assert.equal(
    (await request(path, { action: "configure", settings })).status,
    200,
  );
  const changed = await overview();
  assert.equal(changed.kind, "ready");
  if (changed.kind !== "ready") return;
  assert.equal(changed.settings.time, "03:15");
  assert.equal(changed.settings.retentionDays, 14);
  assert.equal(changed.settings.nextRun, null);
  const count = changed.snapshots.length;
  assert.equal((await request(path, { action: "backup" })).status, 200);
  assert.equal(
    (await request(path, { action: "verify" })).status,
    400,
    "Concurrent backup operations must be rejected.",
  );
  for (let i = 0; i < 40; i++) {
    const value = await overview();
    if (value.kind === "ready" && value.health !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const backedUp = await overview();
  assert.equal(backedUp.kind, "ready");
  if (backedUp.kind !== "ready") return;
  assert.equal(backedUp.snapshots.length, count + 1);
  assert.notEqual(backedUp.latestSnapshotId, initial.latestSnapshotId);
  assert.notEqual(
    backedUp.restore.snapshotId,
    backedUp.latestSnapshotId,
    "A new backup cannot inherit an older restore badge.",
  );
  assert.equal((await request(path, { action: "verify" })).status, 200);
  for (let i = 0; i < 40; i++) {
    const value = await overview();
    if (value.kind === "ready" && value.health !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const verified = await overview();
  assert.equal(verified.kind, "ready");
  if (verified.kind !== "ready") return;
  assert.equal(verified.restore.snapshotId, verified.latestSnapshotId);
  assert.equal(verified.restore.storageApiVerified, false);
  assert.equal(
    (await request(path, { action: "configure", settings: previous })).status,
    200,
  );
  const events = backupEventsSchema.parse(
    await (await request(`${path}/events`)).json(),
  );
  assert.ok(events.events.some((event) => event.event === "backup_complete"));
  assert.ok(events.events.some((event) => event.event === "verify_complete"));
  assert.equal(
    (
      await request(path, {
        action: "destination",
        mount: verified.settings.mount,
        mode: "migrate",
      })
    ).status,
    400,
  );
  const originalIds = verified.snapshots.map((snapshot) => snapshot.id);
  async function waitForDestination() {
    for (let i = 0; i < 50; i++) {
      const value = await overview();
      if (value.kind === "ready" && value.destinationChange.kind === "idle")
        return value;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error("Destination job did not finish");
  }
  assert.equal(
    (
      await request(path, {
        action: "destination",
        mount: "/mnt/demo-backups",
        mode: "migrate",
      })
    ).status,
    200,
  );
  const pending = await overview();
  assert.equal(pending.kind, "ready");
  if (pending.kind !== "ready") return;
  assert.equal(
    pending.settings.mount,
    verified.settings.mount,
    "Do not switch before verification finishes",
  );
  assert.equal(pending.destinationChange.kind, "pending");
  assert.equal((await request(path, { action: "backup" })).status, 400);
  const migrated = await waitForDestination();
  assert.equal(migrated.settings.mount, "/mnt/demo-backups");
  assert.deepEqual(
    migrated.snapshots.map((snapshot) => snapshot.id),
    originalIds,
  );
  assert.equal(migrated.restore.snapshotId, verified.restore.snapshotId);
  assert.equal(
    (
      await request(path, {
        action: "destination",
        mount: "/mnt/demo-empty",
        mode: "fresh",
      })
    ).status,
    200,
  );
  const fresh = await waitForDestination();
  assert.equal(fresh.settings.mount, "/mnt/demo-empty");
  assert.equal(fresh.snapshots.length, 0);
  assert.equal(fresh.latestSnapshotId, null);
  assert.equal(fresh.lastSuccess, null);
  assert.equal(fresh.restore.snapshotId, null);
  assert.equal(fresh.restore.filesVerified, false);
  assert.equal(fresh.health, "attention");
  assert.equal(fresh.settings.retentionDays, previous.retentionDays);
  const response = await request(path);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  process.stdout.write(
    "Backup API smoke passed: schedule persistence, CSRF, validation, concurrent job rejection, completed snapshot, exact restore badge, activity, destination migration, empty repository status reset, and no-store responses.\n",
  );
}
main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
