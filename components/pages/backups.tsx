"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { backupSchema, type Backup } from "@/lib/schemas";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Icon } from "../ui/icon";
import {
  capitalize,
  Empty,
  formatBytes,
  Loading,
  Menu,
  MenuItem,
  MenuSeparator,
  PageHead,
  Segmented,
  Tile,
  timeAgo,
} from "../kit";
import { useConfirm } from "../confirm";
import { okSchema, useWorkspace } from "../workspace";

function succeeded(status: string) {
  return ["success", "successful", "finished"].includes(status.toLowerCase());
}

export function BackupsPage() {
  const { data, openCoolify, invalidate } = useWorkspace();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const databases = data.resources.filter((r) => r.kind === "database");
  const query = useQuery({
    queryKey: ["backups"],
    queryFn: () =>
      api(
        "backups",
        z.object({
          backups: z.array(backupSchema),
          warnings: z.array(z.string()),
        }),
      ),
    refetchInterval: 20000,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [databaseId, setDatabaseId] = useState("");
  const [frequency, setFrequency] = useState<
    "hourly" | "daily" | "weekly" | "monthly"
  >("daily");
  const [restore, setRestore] = useState<Backup | null>(null);
  const [restorePath, setRestorePath] = useState("");
  const [restoreSource, setRestoreSource] = useState<"server" | "s3">("server");
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const mutation = useMutation({
    mutationFn: (v: { path: string; body: Record<string, unknown> }) =>
      api(v.path, okSchema, v.body),
    onSuccess: (_r, v) => {
      setCreateOpen(false);
      if (v.path.endsWith("/restore")) {
        setRestore(null);
        toast.success("Database restore queued in Coolify");
      } else
        toast.success(
          v.body.action === "run"
            ? "Database backup started"
            : v.body.action === "delete"
              ? "Backup schedule deleted"
              : v.body.frequency
                ? "Backup schedule created"
                : "Backup settings updated",
        );
      void queryClient.invalidateQueries({ queryKey: ["backups"] });
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const schedulePath = (b: Backup) =>
    `backups/${encodeURIComponent(b.databaseId)}/${encodeURIComponent(b.id)}`;
  return (
    <>
      <PageHead
        icon="backup"
        hue="backup"
        title="Backups"
        description="Schedules and recent database snapshots."
      >
        <Button
          onClick={() => {
            setDatabaseId(databases[0]?.id ?? "");
            setCreateOpen(true);
          }}
          disabled={databases.length === 0}
        >
          <Icon name="plus" size={16} />
          Add schedule
        </Button>
      </PageHead>
      {query.isLoading ? (
        <Loading rows={3} />
      ) : query.isError ? (
        <Empty
          icon="backup"
          hue="red"
          title="Backup information unavailable"
          description={query.error.message}
          action={() => void query.refetch()}
          actionLabel="Try again"
        />
      ) : (
        <>
          {(query.data?.warnings.length ?? 0) > 0 && (
            <div className="banner banner-amber" role="status">
              <Icon name="danger" size={18} />
              <span>{query.data?.warnings.join(" ")}</span>
            </div>
          )}
          {(query.data?.backups.length ?? 0) === 0 ? (
            <Empty
              icon="backup"
              hue="backup"
              title="No backup schedules yet"
              description={
                databases.length
                  ? "Create a schedule for a database. Coolify keeps the backup files and applies retention rules."
                  : "Create a database before scheduling backups."
              }
              action={() => setCreateOpen(true)}
              actionLabel="Create schedule"
            />
          ) : (
            <div className="backup-grid">
              {query.data?.backups.map((backup) => {
                const latest = backup.executions[0];
                const lastSuccessful = backup.executions.find((e) =>
                  succeeded(e.status),
                );
                const latestOk = latest ? succeeded(latest.status) : null;
                return (
                  <section
                    className={`backup-card ${backup.enabled ? "" : "paused"}`}
                    key={backup.id}
                  >
                    <div className="backup-head">
                      <Tile icon="database" hue="database" />
                      <span className="row-text">
                        <Link
                          className="row-title"
                          href={`/databases/${encodeURIComponent(backup.databaseId)}`}
                        >
                          {backup.databaseName}
                        </Link>
                        <span className="row-sub">{backup.engine}</span>
                      </span>
                      <Menu
                        label={`More actions for ${backup.databaseName} backup`}
                      >
                        <MenuItem
                          icon={backup.enabled ? "pause" : "play"}
                          onSelect={() =>
                            mutation.mutate({
                              path: schedulePath(backup),
                              body: {
                                action: backup.enabled ? "disable" : "enable",
                              },
                            })
                          }
                        >
                          {backup.enabled
                            ? "Pause schedule"
                            : "Resume schedule"}
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem
                          icon="trash"
                          danger
                          onSelect={async () => {
                            const ok = await confirm({
                              title: `Delete ${backup.databaseName} backup schedule?`,
                              description:
                                "This removes the schedule and its execution history. Existing S3 files are kept.",
                              confirmLabel: "Delete schedule",
                              icon: "trash",
                              typeToConfirm: backup.databaseName,
                            });
                            if (ok)
                              mutation.mutate({
                                path: schedulePath(backup),
                                body: {
                                  action: "delete",
                                  confirmation: backup.databaseName,
                                },
                              });
                          }}
                        >
                          Delete schedule
                        </MenuItem>
                      </Menu>
                    </div>
                    <div className="backup-chips">
                      <span className="meta-chip">
                        <Icon name="calendar" size={13} />
                        {capitalize(backup.frequency)}
                      </span>
                      <span className="meta-chip">
                        <Icon
                          name={backup.saveS3 ? "cloud" : "disk"}
                          size={13}
                        />
                        {backup.saveS3 ? "S3 copy" : "Local storage"}
                      </span>
                      {!backup.enabled && (
                        <span className="meta-chip chip-amber">
                          <Icon name="pause" size={13} />
                          Paused
                        </span>
                      )}
                    </div>
                    <div className="backup-latest">
                      <span
                        className={`pill ${latestOk === null ? "s-unknown" : latestOk ? "s-running" : "s-failed"}`}
                      >
                        <span className="dot" />
                        {latest ? capitalize(latest.status) : "No backups yet"}
                      </span>
                      <span className="mono muted">
                        {latest ? timeAgo(latest.date) : "—"}
                      </span>
                      <span className="mono backup-size">
                        {latest
                          ? formatBytes(latest.size)
                          : "Waiting for first run"}
                      </span>
                    </div>
                    <div className="backup-history" aria-hidden>
                      {Array.from({ length: 14 }, (_, i) => {
                        const execution = backup.executions[13 - i];
                        return (
                          <span
                            key={i}
                            className={`bar ${execution ? (succeeded(execution.status) ? "d-successful" : "d-failed") : "bar-empty"}`}
                          />
                        );
                      })}
                    </div>
                    <div className="backup-actions">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={mutation.isPending || !backup.enabled}
                        onClick={() =>
                          mutation.mutate({
                            path: schedulePath(backup),
                            body: { action: "run" },
                          })
                        }
                      >
                        <Icon name="bolt" size={15} />
                        Run now
                      </Button>
                      {lastSuccessful && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setRestore(backup);
                            setRestorePath(
                              lastSuccessful.filename.startsWith("/")
                                ? lastSuccessful.filename
                                : "",
                            );
                            setRestoreConfirmation("");
                            setRestoreSource(
                              backup.saveS3 && backup.s3StorageId
                                ? "s3"
                                : "server",
                            );
                          }}
                        >
                          <Icon name="restart" size={15} />
                          Restore
                        </Button>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
          <div className="list-foot">
            <Icon name="disk" size={15} />
            Backup files and retention remain managed by Coolify.
            <button className="text-link" onClick={() => openCoolify()}>
              Advanced settings
              <Icon name="arrowUpRight" size={14} />
            </button>
          </div>
        </>
      )}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => !mutation.isPending && setCreateOpen(open)}
        icon={<Tile icon="backup" hue="backup" />}
        title="Add a backup schedule"
        description="Coolify will create and retain database backups on this schedule."
      >
        <div className="form">
          <label className="field">
            <span>Database</span>
            <select
              value={databaseId || databases[0]?.id || ""}
              onChange={(e) => setDatabaseId(e.target.value)}
            >
              {databases.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>Frequency</span>
            <Segmented
              full
              value={frequency}
              onChange={setFrequency}
              options={(["hourly", "daily", "weekly", "monthly"] as const).map(
                (f) => ({ value: f, label: capitalize(f) }),
              )}
            />
          </div>
          <div className="dialog-actions">
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={mutation.isPending || databases.length === 0}
              onClick={() =>
                mutation.mutate({
                  path: "backups/schedule",
                  body: {
                    databaseId: databaseId || databases[0]?.id,
                    frequency,
                  },
                })
              }
            >
              {mutation.isPending ? "Saving…" : "Create schedule"}
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog
        open={!!restore}
        onOpenChange={(open) =>
          !open && !mutation.isPending && setRestore(null)
        }
        icon={<Tile icon="restart" hue="amber" />}
        title={`Restore ${restore?.databaseName ?? "database"}?`}
        description="Coolify will queue a restore from the selected backup file."
        wide
      >
        <div className="form">
          <div className="banner banner-amber">
            <Icon name="danger" size={18} />
            <span>
              This replaces existing database objects with the backup contents.
              The database may be unavailable during restore.
            </span>
          </div>
          <div className="field">
            <span>Backup location</span>
            <Segmented
              full
              value={restoreSource}
              onChange={setRestoreSource}
              options={[
                { value: "server", label: "Server storage" },
                {
                  value: "s3",
                  label: "S3 storage",
                  disabled: !restore?.saveS3 || !restore.s3StorageId,
                },
              ]}
            />
          </div>
          <label className="field">
            <span>Backup file path</span>
            <input
              className="mono"
              value={restorePath}
              onChange={(e) => setRestorePath(e.target.value)}
              placeholder="/var/lib/coolify/backups/..."
            />
            <small className="hint">
              For server storage, enter the absolute path from Coolify backup
              details.
            </small>
          </label>
          <label className="field">
            <span>
              Type <strong className="mono">{restore?.databaseName}</strong> to
              confirm
            </span>
            <input
              value={restoreConfirmation}
              onChange={(e) => setRestoreConfirmation(e.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="dialog-actions">
            <Button
              variant="ghost"
              onClick={() => setRestore(null)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={
                !restore ||
                !restorePath.trim() ||
                (restoreSource === "server" && !restorePath.startsWith("/")) ||
                restoreConfirmation !== restore.databaseName ||
                mutation.isPending
              }
              onClick={() => {
                if (!restore) return;
                mutation.mutate({
                  path: `databases/${encodeURIComponent(restore.databaseId)}/restore`,
                  body: {
                    source: restoreSource,
                    path: restorePath.trim(),
                    s3StorageId: restore.s3StorageId,
                    confirmation: restoreConfirmation,
                    dumpAll: false,
                  },
                });
              }}
            >
              {mutation.isPending ? "Queueing…" : "Restore backup"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
