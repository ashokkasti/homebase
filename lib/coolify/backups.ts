import { z } from "zod";
import { coolifyRequest } from "./client";
import { backupSchema, type Backup, type Resource } from "../schemas";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function bool(value: unknown, fallback = true): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function arrayFrom(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const root = record(value);
  if (!root) return [];
  for (const key of keys) {
    const valueAtKey = root[key];
    if (Array.isArray(valueAtKey)) return valueAtKey;
  }
  const data = record(root.data);
  if (data) {
    for (const key of keys) {
      const valueAtKey = data[key];
      if (Array.isArray(valueAtKey)) return valueAtKey;
    }
  }
  return [];
}

function execution(value: unknown): Backup["executions"][number] | null {
  const item = record(value);
  if (!item) return null;
  const id = text(item.uuid ?? item.id);
  if (!id) return null;
  const size = typeof item.size === "number" ? item.size : null;
  return {
    id,
    filename: text(item.filename ?? item.path),
    size,
    date: text(item.created_at ?? item.date),
    status: text(item.status ?? item.message) || "unknown",
    message: text(item.message),
  };
}

async function readDatabaseBackups(database: Resource): Promise<Backup[]> {
  const root = `/databases/${encodeURIComponent(database.id)}/backups`;
  const response = await coolifyRequest(root);
  const schedules = arrayFrom(response, [
    "backups",
    "scheduled_backups",
    "database_backups",
  ]);
  const backups: Backup[] = [];
  for (const item of schedules) {
    const schedule = record(item);
    if (!schedule) continue;
    const id = text(
      schedule.uuid ?? schedule.scheduled_backup_uuid ?? schedule.id,
    );
    if (!id) continue;
    let executions = arrayFrom(schedule, ["executions"])
      .map(execution)
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    if (!executions.length) {
      try {
        const result = await coolifyRequest(
          `${root}/${encodeURIComponent(id)}/executions`,
        );
        executions = arrayFrom(result, ["executions"])
          .map(execution)
          .filter(
            (entry): entry is NonNullable<typeof entry> => entry !== null,
          );
      } catch {
        executions = [];
      }
    }
    backups.push({
      id,
      databaseId: database.id,
      databaseName: database.name,
      engine: database.engine ?? database.description,
      frequency: text(schedule.frequency) || "daily",
      enabled: bool(schedule.enabled),
      saveS3: bool(schedule.save_s3, false),
      s3StorageId: text(schedule.s3_storage_uuid),
      executions: executions.sort(
        (a, b) => Date.parse(b.date) - Date.parse(a.date),
      ),
    });
  }
  return backups;
}

export async function getBackups(resources: Resource[]) {
  const databases = resources.filter(
    (resource) => resource.kind === "database",
  );
  const backups: Backup[] = [];
  const warnings: string[] = [];
  for (let index = 0; index < databases.length; index += 4) {
    const batch = databases.slice(index, index + 4);
    const results = await Promise.allSettled(batch.map(readDatabaseBackups));
    for (const [resultIndex, result] of results.entries()) {
      if (result.status === "fulfilled") backups.push(...result.value);
      else {
        const database = batch[resultIndex];
        if (database)
          warnings.push(`${database.name}: backup information is unavailable.`);
      }
    }
  }
  return { backups: z.array(backupSchema).parse(backups), warnings };
}
