import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backupInstallSchema,
  backupMutationSchema,
  backupOverviewSchema,
  scheduleSchema,
} from "../lib/backup-schemas";
import {
  agentBundle,
  shellQuote,
  serverBackupOverview,
} from "../lib/coolify/server-backups";
import {
  demoBackupOverview,
  demoBackupAction,
  nextDemoRun,
} from "../lib/demo-server-backups";

test("backup settings reject injected calendars and immutable host paths", () => {
  const good = {
    time: "02:00",
    timezone: "Asia/Kathmandu",
    retentionDays: 30,
    minimumFreeGiB: 20,
    enabled: true,
  };
  assert.equal(scheduleSchema.safeParse(good).success, true);
  for (const changes of [
    { time: "02:00\nExecStart=sh" },
    { timezone: "UTC;id" },
    { retentionDays: 0 },
    { mount: "/etc" },
    { minimumFreeGiB: -1 },
    { retentionDays: true },
  ])
    assert.equal(
      scheduleSchema.safeParse({ ...good, ...changes }).success,
      false,
    );
  assert.equal(
    backupMutationSchema.safeParse({
      action: "configure",
      settings: good,
      password: "x",
    }).success,
    false,
  );
  assert.equal(
    backupMutationSchema.safeParse({ action: "delete" }).success,
    false,
  );
  assert.equal(
    backupMutationSchema.safeParse({ action: "restore" }).success,
    false,
  );
});

test("install accepts an existing mount but no formatting or arbitrary asset payload", () => {
  assert.equal(
    backupInstallSchema.safeParse({ mount: "/srv/backups", project: "p123" })
      .success,
    true,
  );
  for (const mount of [
    "/",
    "/etc",
    "/srv/../etc",
    "/srv/$(id)",
    "/srv/back ups",
  ])
    assert.equal(
      backupInstallSchema.safeParse({ mount }).success,
      false,
      mount,
    );
  assert.equal(
    backupMutationSchema.safeParse({
      action: "install",
      mount: "/srv/backups",
      files: [],
    }).success,
    false,
  );
  assert.equal(
    backupMutationSchema.safeParse({
      action: "install",
      mount: "/srv/backups",
      format: true,
    }).success,
    false,
  );
});

test("SSH quoting preserves quotes, newlines and shell substitutions literally", () => {
  const value = "a'b;$(printf wrong)\nnext";
  assert.equal(
    execFileSync("/bin/sh", ["-c", `printf '%s' ${shellQuote(value)}`], {
      encoding: "utf8",
    }),
    value,
  );
});

test("bundled host installer includes all controls, units and verified checksums", async () => {
  const files = await agentBundle();
  assert.equal(files.length, 15);
  assert.ok(files.some((f) => f.name === "control.py"));
  assert.ok(
    files.some((f) => f.name === "systemd/homeserver-backup-recover.service"),
  );
  for (const file of files) {
    assert.equal(
      createHash("sha256")
        .update(Buffer.from(file.content, "base64"))
        .digest("hex"),
      file.sha256,
    );
    assert.ok(!file.name.includes(".."));
  }
});

test("demo reports a verified older snapshot without claiming the latest was tested", () => {
  const data = backupOverviewSchema.parse(demoBackupOverview());
  assert.equal(data.kind, "ready");
  if (data.kind !== "ready") return;
  assert.notEqual(data.restore.snapshotId, data.latestSnapshotId);
  assert.equal(data.restore.storageApiVerified, false);
  assert.equal(data.disk.kind, "mounted");
});

test("demo configuration persists schedule and retention edits", () => {
  const settings = {
    time: "03:15",
    timezone: "Europe/London",
    retentionDays: 14,
    minimumFreeGiB: 30,
    enabled: false,
  };
  demoBackupAction({ action: "configure", settings });
  const data = demoBackupOverview();
  assert.equal(data.kind, "ready");
  if (data.kind !== "ready") return;
  assert.equal(data.settings.time, "03:15");
  assert.equal(data.settings.retentionDays, 14);
  assert.equal(data.settings.enabled, false);
  assert.equal(data.settings.nextRun, null);
});

test("a real missing connection fails instead of returning demonstration backups", async () => {
  const folder = await mkdtemp(join(tmpdir(), "homebase-backups-"));
  const keys = [
    "HOMEBASE_COOLIFY_URL",
    "HOMEBASE_COOLIFY_TOKEN",
    "COOLIFY_URL",
    "COOLIFY_TOKEN",
    "HOMEBASE_DATA_DIR",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.HOMEBASE_DATA_DIR = folder;
    await assert.rejects(
      serverBackupOverview("server1"),
      /Connect your Coolify server/,
    );
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(folder, { recursive: true, force: true });
  }
});

test("demo next run matches the configured wall clock and timezone", () => {
  const now = Date.parse("2026-11-01T16:00:00Z");
  assert.equal(
    nextDemoRun("02:00", "Asia/Kathmandu", now),
    "2026-11-01T20:15:00.000Z",
  );
  assert.equal(
    nextDemoRun("03:15", "Europe/London", now),
    "2026-11-02T03:15:00.000Z",
  );
});

test("destination changes require a dedicated path and an explicit strategy", () => {
  for (const mode of ["migrate", "fresh"]) {
    assert.equal(
      backupMutationSchema.safeParse({
        action: "destination",
        mount: "/mnt/backup-disk",
        mode,
      }).success,
      true,
    );
  }
  for (const value of [
    { action: "destination", mount: "/", mode: "fresh" },
    { action: "destination", mount: "/mnt/../etc", mode: "migrate" },
    { action: "destination", mount: "/mnt/disk", mode: "delete" },
    { action: "destination", mount: "/mnt/disk", mode: "fresh", format: true },
    { action: "destination", mount: "/mnt/disk" },
  ])
    assert.equal(backupMutationSchema.safeParse(value).success, false);
});
