import { z } from "zod";

export const scheduleSchema = z
  .object({
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    timezone: z
      .string()
      .min(1)
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Enter an IANA timezone such as Asia/Kathmandu."),
    retentionDays: z.number().int().min(1).max(365),
    minimumFreeGiB: z.number().int().min(1).max(10000),
    enabled: z.boolean(),
  })
  .strict();
export type BackupSchedule = z.infer<typeof scheduleSchema>;
export const backupInstallSchema = z
  .object({
    mount: z
      .string()
      .regex(/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/)
      .max(512)
      .refine(
        (p) =>
          !p.split("/").some((s) => s === "." || s === "..") &&
          !["/", "/etc", "/var", "/home", "/boot", "/data"].includes(p),
        "Choose the dedicated backup mount.",
      ),
    project: z
      .string()
      .regex(/^(?:[A-Za-z0-9][A-Za-z0-9_-]{0,127})?$/)
      .default(""),
  })
  .strict();
export const destinationSchema = z
  .object({
    mount: backupInstallSchema.shape.mount,
    mode: z.enum(["migrate", "fresh"]),
  })
  .strict();
export type BackupDestination = z.infer<typeof destinationSchema>;

export const backupMutationSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("configure"), settings: scheduleSchema })
    .strict(),
  z
    .object({
      action: z.enum([
        "backup",
        "verify",
        "maintenance",
        "destination_retry",
        "destination_cancel",
      ]),
    })
    .strict(),
  z
    .object({ action: z.literal("destination"), ...destinationSchema.shape })
    .strict(),
  z
    .object({ action: z.literal("install"), ...backupInstallSchema.shape })
    .strict(),
]);
export type BackupMutation = z.infer<typeof backupMutationSchema>;
export const snapshotSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  time: z.string(),
  state: z.enum(["complete", "incomplete"]),
  bytes: z.number().nonnegative().nullable(),
  addedBytes: z.number().nonnegative().nullable(),
  files: z.number().nonnegative().nullable(),
  durationSeconds: z.number().nonnegative().nullable(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const backupOverviewSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("not_installed"),
    legacy: z.boolean(),
    mount: z.string(),
    project: z.string(),
  }),
  z.object({
    kind: z.literal("ready"),
    version: z.string(),
    canChangeDestination: z.boolean().default(false),
    name: z.string(),
    health: z.enum(["running", "attention", "healthy"]),
    problems: z.array(z.string()),
    settings: scheduleSchema.extend({
      mount: z.string(),
      project: z.string(),
      nextRun: z.string().nullable(),
    }),
    jobs: z.array(
      z.object({
        kind: z.enum(["backup", "verify", "maintenance", "destination"]),
        state: z.string(),
        result: z.string(),
        exitCode: z.number(),
      }),
    ),
    lastSuccess: z.string().nullable(),
    lastAttempt: z.string().nullable(),
    lastDurationSeconds: z.number().nullable(),
    latestSnapshotId: z.string().nullable(),
    disk: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("mounted"),
        totalBytes: z.number(),
        freeBytes: z.number(),
        usedBytes: z.number(),
        uuid: z.string(),
      }),
      z.object({ kind: z.literal("unavailable"), message: z.string() }),
    ]),
    snapshots: z.array(snapshotSchema),
    historyComplete: z.boolean(),
    retentionState: z.string(),
    destinationChange: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("idle") }),
        z.object({
          kind: z.literal("pending"),
          mount: z.string(),
          mode: z.enum(["migrate", "fresh"]),
          error: z.string().nullable(),
        }),
      ])
      .default({ kind: "idle" }),
    restore: z.object({
      time: z.string().nullable(),
      snapshotId: z.string().nullable(),
      filesVerified: z.boolean(),
      databaseVerified: z.boolean(),
      storageApiVerified: z.literal(false),
      counts: z
        .object({
          databases: z.number(),
          auth_users: z.number(),
          storage_objects: z.number(),
          storage_buckets: z.number(),
        })
        .nullable(),
    }),
  }),
]);
export type BackupOverview = z.infer<typeof backupOverviewSchema>;
export const backupEventsSchema = z.object({
  events: z.array(
    z.object({
      time: z.string(),
      event: z.string(),
      container: z.string().nullable(),
      snapshot: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
});
