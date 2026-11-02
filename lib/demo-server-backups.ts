import { createHash } from "node:crypto";
import {
  backupOverviewSchema,
  type BackupMutation,
  type BackupDestination,
} from "./backup-schemas";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function nextDemoRun(
  time: string,
  timezone: string,
  stamp = Date.now(),
) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  function wallTime(value: number) {
    const parts = Object.fromEntries(
      formatter.formatToParts(value).map((part) => [part.type, part.value]),
    );
    return Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
  }
  const [hours, minutes] = time.split(":").map(Number);
  const today = new Date(wallTime(stamp));
  let desired = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
    hours,
    minutes,
  );
  function toUtc(target: number) {
    let guess = target;
    for (let i = 0; i < 3; i++) guess -= wallTime(guess) - target;
    return guess;
  }
  if (toUtc(desired) <= stamp) desired += 86400000;
  return new Date(toUtc(desired)).toISOString();
}
function initial() {
  const now = Date.now();
  const snapshots = Array.from({ length: 14 }, (_, i) => ({
    id: hash(`demo-snapshot-${i}`),
    time: new Date(now - 2 * 3600000 - i * 86400000).toISOString(),
    state: "complete",
    bytes: 485245632 + i * 1490048,
    addedBytes: i === 13 ? 485245632 : 1490048,
    files: 1248 + i,
    durationSeconds: 28 + i,
  }));
  return backupOverviewSchema.parse({
    kind: "ready",
    version: "1.2.0",
    canChangeDestination: true,
    name: "Supabase",
    health: "healthy",
    problems: [],
    settings: {
      time: "02:00",
      timezone: "Asia/Kathmandu",
      retentionDays: 30,
      minimumFreeGiB: 20,
      enabled: true,
      nextRun: nextDemoRun("02:00", "Asia/Kathmandu", now),
      mount: "/srv/backups",
      project: "supabase",
    },
    jobs: ["backup", "verify", "maintenance", "destination"].map((kind) => ({
      kind,
      state: "inactive",
      result: "success",
      exitCode: 0,
    })),
    lastSuccess: snapshots[0]?.time,
    lastAttempt: snapshots[0]?.time,
    lastDurationSeconds: 28,
    latestSnapshotId: snapshots[0]?.id,
    disk: {
      kind: "mounted",
      totalBytes: 492000000000,
      freeBytes: 471000000000,
      usedBytes: 21000000000,
      uuid: "demo-disk",
    },
    snapshots,
    historyComplete: true,
    retentionState: "ok",
    restore: {
      time: new Date(now - 86400000).toISOString(),
      snapshotId: snapshots[1]?.id,
      filesVerified: true,
      databaseVerified: true,
      storageApiVerified: false,
      counts: {
        databases: 5,
        auth_users: 3,
        storage_objects: 34,
        storage_buckets: 3,
      },
    },
  });
}
let state = initial();
let pending: {
  action: "backup" | "verify" | "maintenance" | "destination";
  destination?: BackupDestination;
  doneAt: number;
} | null = null;
let events: {
  time: string;
  event: string;
  container: string | null;
  snapshot: string | null;
  error: string | null;
}[] = [];
function ready() {
  if (state.kind !== "ready") throw new Error("Demo service is not installed.");
  return state;
}
export function demoBackupOverview() {
  const current = ready();
  if (pending && Date.now() >= pending.doneAt) {
    const stamp = new Date().toISOString();
    const action = pending.action;
    if (action === "destination" && pending.destination) {
      current.settings.mount = pending.destination.mount;
      if (current.disk.kind === "mounted")
        current.disk.uuid = hash(pending.destination.mount);
      if (pending.destination.mode === "fresh") {
        current.snapshots = [];
        current.latestSnapshotId = null;
        current.lastSuccess = null;
        current.lastAttempt = null;
        current.lastDurationSeconds = null;
        current.retentionState = "not_checked";
        current.restore = {
          time: null,
          snapshotId: null,
          filesVerified: false,
          databaseVerified: false,
          storageApiVerified: false,
          counts: null,
        };
        current.problems = [
          "No successful backup has been recorded.",
          "Run a backup and verify its restore on the new destination.",
        ];
      }
      current.destinationChange = { kind: "idle" };
    } else if (action === "backup") {
      const snapshot = {
        id: hash(stamp),
        time: stamp,
        state: "complete",
        bytes: 487000000,
        addedBytes: 1450000,
        files: 1254,
        durationSeconds: 8,
      };
      current.snapshots.unshift({ ...snapshot, state: "complete" });
      current.lastSuccess = stamp;
      current.latestSnapshotId = snapshot.id;
      current.lastDurationSeconds = 8;
      current.problems = current.problems.filter(
        (message) => message !== "No successful backup has been recorded.",
      );
    } else if (action === "verify") {
      current.restore.time = stamp;
      current.restore.snapshotId = current.latestSnapshotId;
      current.restore.filesVerified = true;
      current.restore.databaseVerified = true;
      current.restore.counts = {
        databases: 5,
        auth_users: 3,
        storage_objects: 34,
        storage_buckets: 3,
      };
      current.problems = [];
    }
    current.health = current.problems.length ? "attention" : "healthy";
    current.jobs = current.jobs.map((j) => ({ ...j, state: "inactive" }));
    events.push({
      time: stamp,
      event: `${action}_complete`,
      container: null,
      snapshot: current.latestSnapshotId,
      error: null,
    });
    pending = null;
  }
  return state;
}
export function demoBackupAction(input: BackupMutation) {
  demoBackupOverview();
  const current = ready();
  if (pending) throw new Error("Another backup operation is running.");
  if (input.action === "configure") {
    current.settings = { ...current.settings, ...input.settings };
    current.settings.nextRun = input.settings.enabled
      ? nextDemoRun(input.settings.time, input.settings.timezone)
      : null;
  } else if (input.action === "destination") {
    if (input.mount === current.settings.mount)
      throw new Error("Choose a different mounted backup disk.");
    pending = {
      action: "destination",
      destination: input,
      doneAt: Date.now() + 8000,
    };
    current.destinationChange = {
      kind: "pending",
      mount: input.mount,
      mode: input.mode,
      error: null,
    };
    current.health = "running";
    current.jobs = current.jobs.map((j) => ({
      ...j,
      state: j.kind === "destination" ? "activating" : "inactive",
    }));
  } else if (
    input.action === "destination_retry" ||
    input.action === "destination_cancel"
  ) {
    throw new Error("No failed destination change is pending.");
  } else if (input.action !== "install") {
    pending = { action: input.action, doneAt: Date.now() + 8000 };
    current.health = "running";
    current.jobs = current.jobs.map((j) => ({
      ...j,
      state: j.kind === input.action ? "activating" : "inactive",
    }));
    current.lastAttempt = new Date().toISOString();
  }
  return {
    ok: true,
    message:
      input.action === "configure"
        ? "Backup settings saved"
        : input.action === "install"
          ? "Backup agent updated"
          : `${input.action} queued`,
  };
}
export function demoBackupEvents() {
  return { events };
}
