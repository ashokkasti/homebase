"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  backupOverviewSchema,
  backupEventsSchema,
  scheduleSchema,
  destinationSchema,
  type BackupDestination,
  type BackupOverview,
  type BackupMutation,
  type BackupSchedule,
  type Snapshot,
} from "@/lib/backup-schemas";
import { useWorkspace } from "../workspace";
import { useConfirm } from "../confirm";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Icon } from "../ui/icon";
import {
  CopyButton,
  Empty,
  Loading,
  Tile,
  formatBytes,
  formatDate,
  formatDuration,
  timeAgo,
} from "../kit";

const backupBytes = (value: number | null) =>
  value === 0 ? "0 B" : formatBytes(value);

const resultSchema = z.object({ ok: z.literal(true), message: z.string() });

export function ServerBackupsPanel() {
  const { data } = useWorkspace();
  const [selected, setSelected] = useState("");
  const serverId = selected || data.servers[0]?.id || "";
  if (!serverId)
    return (
      <Empty
        icon="server"
        hue="backup"
        title="No servers connected"
        description="Connect your Coolify server to manage database and Storage backups."
      />
    );
  return (
    <>
      <div className="server-backup-toolbar">
        <label className="field server-backup-server">
          <span>Server</span>
          <select
            value={serverId}
            onChange={(e) => setSelected(e.target.value)}
          >
            {data.servers.map((server) => (
              <option value={server.id} key={server.id}>
                {server.name}
              </option>
            ))}
          </select>
        </label>
        <p>
          Database, Storage objects, and deployment configuration in one
          recovery point.
        </p>
      </div>
      <BackupService key={serverId} serverId={serverId} />
    </>
  );
}

function BackupService({ serverId }: { serverId: string }) {
  const client = useQueryClient();
  const confirm = useConfirm();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [destinationOpen, setDestinationOpen] = useState(false);
  const [details, setDetails] = useState<Snapshot | null>(null);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "complete" | "incomplete">(
    "all",
  );
  const queryKey = ["server-backup", serverId];
  const query = useQuery({
    queryKey,
    queryFn: () =>
      api(
        `server-backups/${encodeURIComponent(serverId)}`,
        backupOverviewSchema,
      ),
    refetchInterval: 5000,
  });
  const events = useQuery({
    queryKey: [...queryKey, "events"],
    queryFn: () =>
      api(
        `server-backups/${encodeURIComponent(serverId)}/events`,
        backupEventsSchema,
      ),
    enabled: eventsOpen && query.data?.kind === "ready",
    refetchInterval: eventsOpen ? 5000 : false,
  });
  const mutation = useMutation({
    mutationFn: (body: BackupMutation) =>
      api(`server-backups/${encodeURIComponent(serverId)}`, resultSchema, body),
    onSuccess: (result) => {
      toast.success(result.message);
      setSettingsOpen(false);
      setDestinationOpen(false);
      void client.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(error.message),
  });
  async function run(action: "backup" | "verify" | "maintenance") {
    if (action === "backup") {
      const accepted = await confirm({
        title: "Run a server backup now?",
        description:
          "Supabase APIs and workers will pause while PostgreSQL and the object store stop for capture. Applications may be temporarily unavailable. Everything resumes after capture, including on failure.",
        confirmLabel: "Run backup",
        icon: "backup",
        tone: "default",
      });
      if (!accepted) return;
    }
    if (action === "maintenance") {
      const accepted = await confirm({
        title: "Run repository maintenance?",
        description:
          "Checks repository integrity and applies the configured retention policy. Expired snapshots may be removed; unreferenced data is pruned during weekly maintenance.",
        confirmLabel: "Run maintenance",
        icon: "disk",
        tone: "default",
      });
      if (!accepted) return;
    }
    mutation.mutate({ action });
  }
  if (query.isLoading) return <Loading rows={5} />;
  if (query.isError || !query.data)
    return (
      <Empty
        icon="backup"
        hue="red"
        title="Cannot reach the backup service"
        description={
          query.error?.message ||
          "The server did not return backup information."
        }
        action={() => void query.refetch()}
        actionLabel="Try again"
      />
    );
  const data = query.data;
  if (data.kind === "not_installed")
    return (
      <InstallService
        data={data}
        pending={mutation.isPending}
        install={(mount, project) =>
          mutation.mutate({ action: "install", mount, project })
        }
      />
    );
  const busy = data.health === "running" || mutation.isPending;
  const snapshots = data.snapshots.filter(
    (s) => filter === "all" || s.state === filter,
  );
  const completeCount = data.snapshots.filter(
    (s) => s.state === "complete",
  ).length;
  const activeJob = data.jobs.find((j) =>
    ["active", "activating", "deactivating"].includes(j.state),
  );
  const title =
    data.health === "running"
      ? `${activeJob?.kind === "destination" ? "Destination change" : activeJob?.kind === "verify" ? "Restore verification" : activeJob?.kind === "maintenance" ? "Maintenance" : "Backup"} in progress`
      : data.health === "attention"
        ? "Backups need attention"
        : "Backups are current";
  return (
    <div className="server-backup-stack">
      <section
        className={`server-backup-health ${data.health}`}
        aria-label="Backup health"
      >
        <Tile
          icon={data.health === "attention" ? "danger" : "shield"}
          hue={
            data.health === "attention"
              ? "amber"
              : data.health === "running"
                ? "backup"
                : "green"
          }
          size="lg"
        />
        <div className="server-backup-health-copy" aria-live="polite">
          <h2>{title}</h2>
          <p>
            {data.lastSuccess ? (
              <>
                Last successful capture {timeAgo(data.lastSuccess)}
                {data.lastDurationSeconds !== null
                  ? ` · ${formatDuration(data.lastDurationSeconds)}`
                  : ""}
                .
              </>
            ) : (
              "Run the first backup to create a recovery point."
            )}
          </p>
          {!data.settings.enabled && (
            <span className="pill s-stopped">Nightly schedule paused</span>
          )}
        </div>
        <div className="server-backup-actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="settings" size={16} />
            Configure
          </Button>
          <Button
            disabled={busy || data.disk.kind !== "mounted"}
            onClick={() => void run("backup")}
          >
            <Icon name="backup" size={16} />
            {busy ? "Operation running" : "Run backup"}
          </Button>
        </div>
      </section>
      {data.destinationChange.kind === "pending" && (
        <div className="banner banner-amber" role="status">
          <div>
            <strong>
              Changing destination to {data.destinationChange.mount}
            </strong>
            <p>
              {data.destinationChange.error ||
                "Validating the new disk and repository. The old repository is preserved. This job continues if you close Homebase."}
            </p>
            {!busy && (
              <div className="server-backup-actions">
                <Button
                  variant="outline"
                  onClick={() =>
                    mutation.mutate({ action: "destination_retry" })
                  }
                >
                  Retry destination change
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    mutation.mutate({ action: "destination_cancel" })
                  }
                >
                  Cancel destination change
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
      {data.problems.length > 0 && (
        <div className="banner banner-amber" role="status">
          <Icon name="danger" size={18} />
          <div>
            {data.problems.map((problem) => (
              <p key={problem}>{problem}</p>
            ))}
          </div>
        </div>
      )}
      <div className="server-backup-facts">
        <section>
          <Icon name="calendar" />
          <div>
            <span>Next nightly backup</span>
            <strong>
              {!data.settings.enabled
                ? "Schedule paused"
                : data.settings.nextRun
                  ? formatDate(data.settings.nextRun)
                  : "Not scheduled"}
            </strong>
            <small>
              {data.settings.time} · {data.settings.timezone}
            </small>
          </div>
        </section>
        <section>
          <Icon name="disk" />
          <div>
            <span>Backup disk</span>
            <strong>
              {data.disk.kind === "mounted"
                ? `${backupBytes(data.disk.freeBytes)} free`
                : "Disk unavailable"}
            </strong>
            <small className="mono">{data.settings.mount}</small>
            <Button
              variant="ghost"
              size="sm"
              disabled={
                busy ||
                !data.canChangeDestination ||
                data.destinationChange.kind === "pending"
              }
              onClick={() => setDestinationOpen(true)}
            >
              {data.canChangeDestination
                ? "Change backup destination"
                : "Update agent to change destination"}
            </Button>
            {data.disk.kind === "mounted" && (
              <meter
                min={0}
                max={data.disk.totalBytes}
                value={data.disk.usedBytes}
                aria-label="Backup disk usage"
              />
            )}
          </div>
        </section>
        <section>
          <Icon name="shield" />
          <div>
            <span>Recovery window</span>
            <strong>{data.settings.retentionDays} days</strong>
            <small>
              {data.historyComplete
                ? `${completeCount} complete ${completeCount === 1 ? "snapshot" : "snapshots"}`
                : "History unavailable"}{" "}
              · encrypted
            </small>
          </div>
        </section>
      </div>
      <section className="panel server-backup-restore">
        <div className="server-backup-panel-head">
          <div>
            <h2>Restore verification</h2>
            <p>
              A full file restore and a PostgreSQL clone with networking
              disabled.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={
              busy || completeCount === 0 || data.disk.kind !== "mounted"
            }
            onClick={() => void run("verify")}
          >
            <Icon name="check" size={15} />
            Verify latest restore
          </Button>
        </div>
        <div className="server-backup-restore-body">
          <span
            className={`pill ${data.restore.filesVerified && data.restore.databaseVerified ? "s-running" : "s-unknown"}`}
          >
            <span className="dot" />
            {data.restore.filesVerified && data.restore.databaseVerified
              ? "Files and database verified"
              : "Not verified yet"}
          </span>
          <span>
            {data.restore.time
              ? formatDate(data.restore.time)
              : "Run verification after your first backup."}
          </span>
          {data.restore.snapshotId && (
            <span className="mono">
              {data.restore.snapshotId.slice(0, 12)}
              <CopyButton
                value={data.restore.snapshotId}
                label="Copy verified snapshot ID"
              />
            </span>
          )}
        </div>
        {data.restore.counts && (
          <p className="server-backup-counts">
            {data.restore.counts.databases} databases ·{" "}
            {data.restore.counts.auth_users} Auth users ·{" "}
            {data.restore.counts.storage_objects} Storage objects ·{" "}
            {data.restore.counts.storage_buckets} buckets
          </p>
        )}
        <p className="hint">
          Verification applies to the snapshot shown above. Authenticated
          Storage API downloads are not exercised by this check.
        </p>
      </section>
      <section className="panel server-backup-history">
        <div className="server-backup-panel-head">
          <div>
            <h2>
              Snapshots{" "}
              <span className="muted">
                {data.historyComplete ? data.snapshots.length : "—"}
              </span>
            </h2>
            <p>
              Database and Storage files captured together. Incomplete captures
              are not recovery points.
            </p>
          </div>
          <div className="server-backup-filter">
            <label className="sr-only" htmlFor="snapshot-state">
              Snapshot status
            </label>
            <select
              id="snapshot-state"
              value={filter}
              onChange={(e) => {
                const value = e.target.value;
                if (
                  value === "all" ||
                  value === "complete" ||
                  value === "incomplete"
                )
                  setFilter(value);
              }}
            >
              <option value="all">All snapshots</option>
              <option value="complete">Complete</option>
              <option value="incomplete">Incomplete</option>
            </select>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Refresh backups"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <Icon name="refresh" />
            </Button>
          </div>
        </div>
        {!data.historyComplete ? (
          <div className="server-backup-empty">
            Snapshot history could not be read. Refresh after the current
            repository operation finishes.
          </div>
        ) : snapshots.length === 0 ? (
          <div className="server-backup-empty">
            {data.snapshots.length
              ? "No snapshots match this filter."
              : "No snapshots yet. Run a backup to create your first recovery point."}
          </div>
        ) : (
          <div className="server-backup-table-scroll">
            <table className="server-backup-table">
              <thead>
                <tr>
                  <th scope="col">Captured</th>
                  <th scope="col">Snapshot</th>
                  <th scope="col">Status</th>
                  <th scope="col">Protected data</th>
                  <th scope="col">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snapshot) => (
                  <tr key={snapshot.id}>
                    <td>
                      <strong>{formatDate(snapshot.time)}</strong>
                      <small>{timeAgo(snapshot.time)}</small>
                    </td>
                    <td>
                      <span className="mono">{snapshot.id.slice(0, 12)}</span>
                      <CopyButton
                        value={snapshot.id}
                        label="Copy snapshot ID"
                      />
                      {snapshot.id === data.restore.snapshotId && (
                        <small className="server-backup-verified">
                          <Icon name="check" size={12} />
                          Restore verified
                        </small>
                      )}
                    </td>
                    <td>
                      <span
                        className={`pill ${snapshot.state === "complete" ? "s-running" : "s-failed"}`}
                      >
                        <span className="dot" />
                        {snapshot.state === "complete"
                          ? "Complete"
                          : "Incomplete"}
                      </span>
                    </td>
                    <td>
                      {backupBytes(snapshot.bytes)}
                      <small>
                        {snapshot.addedBytes === null
                          ? ""
                          : `${backupBytes(snapshot.addedBytes)} added`}
                      </small>
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDetails(snapshot)}
                      >
                        Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel server-backup-activity">
        <button
          className="server-backup-disclosure"
          aria-expanded={eventsOpen}
          onClick={() => setEventsOpen(!eventsOpen)}
        >
          <Icon name="terminal" size={17} />
          Recent activity
          <Icon name="chevronDown" size={16} />
        </button>
        {eventsOpen &&
          (events.isLoading ? (
            <Loading rows={2} />
          ) : events.isError ? (
            <p role="alert">{events.error.message}</p>
          ) : (
            <div className="server-backup-event-list">
              {events.data?.events.length === 0 && (
                <p className="muted">No systemd activity recorded yet.</p>
              )}
              {events.data?.events
                .slice()
                .reverse()
                .map((event, i) => (
                  <div
                    className="server-backup-event"
                    key={`${event.time}-${i}`}
                  >
                    <time dateTime={event.time}>{formatDate(event.time)}</time>
                    <span>
                      {event.event.replaceAll("_", " ")}
                      {event.container && (
                        <small className="mono">{event.container}</small>
                      )}
                      {event.error && (
                        <small className="server-backup-error">
                          {event.error}
                        </small>
                      )}
                    </span>
                  </div>
                ))}
            </div>
          ))}
      </section>
      <div className="server-backup-footer">
        <span>
          Agent {data.version} · {data.settings.project}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() =>
            mutation.mutate({
              action: "install",
              mount: data.settings.mount,
              project: data.settings.project,
            })
          }
        >
          Update agent
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || completeCount === 0}
          onClick={() => void run("maintenance")}
        >
          Run maintenance
        </Button>
      </div>
      <DestinationDialog
        key={data.settings.mount}
        open={destinationOpen}
        onOpenChange={setDestinationOpen}
        currentMount={data.settings.mount}
        pending={mutation.isPending}
        save={(value) => mutation.mutate({ action: "destination", ...value })}
      />
      <ScheduleDialog
        key={JSON.stringify(data.settings)}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={data.settings}
        pending={mutation.isPending}
        save={(settings) => mutation.mutate({ action: "configure", settings })}
      />
      <Dialog
        open={details !== null}
        onOpenChange={(open) => !open && setDetails(null)}
        title="Snapshot details"
        description="A coordinated database and Storage recovery point."
        icon={<Tile icon="backup" hue="backup" />}
      >
        {details && (
          <dl className="server-backup-detail-list">
            <dt>Snapshot ID</dt>
            <dd className="mono">
              {details.id}
              <CopyButton value={details.id} label="Copy snapshot ID" />
            </dd>
            <dt>Captured</dt>
            <dd>{formatDate(details.time)}</dd>
            <dt>State</dt>
            <dd>
              {details.state === "complete"
                ? "Complete"
                : "Incomplete; do not use for recovery"}
            </dd>
            <dt>Protected data</dt>
            <dd>{backupBytes(details.bytes)}</dd>
            <dt>New data added</dt>
            <dd>{backupBytes(details.addedBytes)}</dd>
            <dt>Files</dt>
            <dd>{details.files?.toLocaleString() ?? "Not reported"}</dd>
            <dt>Capture duration</dt>
            <dd>
              {details.durationSeconds === null
                ? "Not reported"
                : formatDuration(details.durationSeconds)}
            </dd>
            <dt>Repository</dt>
            <dd className="mono">{data.settings.mount}/restic</dd>
            <dt>Restore verification</dt>
            <dd>
              {details.id === data.restore.snapshotId
                ? "Files and database verified"
                : "This snapshot has not been individually restore-tested."}
            </dd>
          </dl>
        )}
      </Dialog>
    </div>
  );
}

function DestinationDialog({
  open,
  onOpenChange,
  currentMount,
  pending,
  save,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  currentMount: string;
  pending: boolean;
  save: (value: BackupDestination) => void;
}) {
  const [mount, setMount] = useState("");
  const [mode, setMode] = useState<BackupDestination["mode"]>("migrate");
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => !pending && onOpenChange(value)}
      title="Change backup destination"
      description="Use another dedicated disk mounted on this server. The current repository is preserved."
      icon={<Tile icon="disk" hue="backup" />}
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = destinationSchema.safeParse({ mount, mode });
          if (!parsed.success) {
            toast.error(
              parsed.error.issues[0]?.message || "Check the destination.",
            );
            return;
          }
          if (mount === currentMount) {
            toast.error("Choose a different mounted backup disk.");
            return;
          }
          save(parsed.data);
        }}
      >
        <p>
          Current repository: <code>{currentMount}/restic</code>
        </p>
        <label className="field">
          <span>New backup mount</span>
          <input
            required
            value={mount}
            onChange={(e) => setMount(e.target.value)}
            placeholder="/mnt/backup-disk"
            autoComplete="off"
          />
          <small>
            Must already be mounted read-write as ext4 with an unused restic
            directory. Homebase checks disk identity and free space. It never
            formats a disk.
          </small>
        </label>
        <fieldset className="form">
          <legend>Existing backups</legend>
          <label className="check-card">
            <input
              type="radio"
              name="destination-mode"
              value="migrate"
              checked={mode === "migrate"}
              onChange={() => setMode("migrate")}
            />
            <span>
              <strong>Copy existing backups</strong>
              <small>
                Copy the full encrypted repository and verify every data pack
                before switching. Snapshot IDs and restore verification are
                preserved. Large repositories can take hours.
              </small>
            </span>
          </label>
          <label className="check-card">
            <input
              type="radio"
              name="destination-mode"
              value="fresh"
              checked={mode === "fresh"}
              onChange={() => setMode("fresh")}
            />
            <span>
              <strong>Start a new repository</strong>
              <small>
                Keep previous backups on the old disk. History on the new disk
                starts empty. Run a backup and verify its restore after
                switching.
              </small>
            </span>
          </label>
        </fieldset>
        <p>
          The host runs this job in the background. Backup jobs are blocked
          until the switch completes or you cancel a failed change. The schedule
          and retention stay unchanged.
        </p>
        <div className="dialog-footer">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Queuing…" : "Verify and switch destination"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ScheduleDialog({
  open,
  onOpenChange,
  settings,
  pending,
  save,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: BackupSchedule;
  pending: boolean;
  save: (value: BackupSchedule) => void;
}) {
  const [value, setValue] = useState<BackupSchedule>({
    time: settings.time,
    timezone: settings.timezone,
    retentionDays: settings.retentionDays,
    minimumFreeGiB: settings.minimumFreeGiB,
    enabled: settings.enabled,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !pending && onOpenChange(next)}
      title="Configure server backups"
      description="Changes apply to the host scheduler and retention policy."
      icon={<Tile icon="settings" hue="backup" />}
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = scheduleSchema.safeParse(value);
          if (!parsed.success) {
            toast.error(
              parsed.error.issues[0]?.message || "Check backup settings.",
            );
            return;
          }
          save(parsed.data);
        }}
      >
        <label className="check-card">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => setValue({ ...value, enabled: e.target.checked })}
          />
          <span>
            <strong>Nightly backups enabled</strong>
            <small>
              Pausing the schedule keeps existing snapshots and does not cancel
              an active backup.
            </small>
          </span>
        </label>
        <div className="server-backup-form-grid">
          <label className="field">
            <span>Daily start time</span>
            <input
              required
              type="time"
              value={value.time}
              onChange={(e) => setValue({ ...value, time: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Timezone</span>
            <input
              required
              value={value.timezone}
              onChange={(e) => setValue({ ...value, timezone: e.target.value })}
              placeholder="Asia/Kathmandu"
            />
          </label>
        </div>
        <div className="server-backup-form-grid">
          <label className="field">
            <span>Retention, days</span>
            <input
              required
              type="number"
              min={1}
              max={365}
              value={value.retentionDays}
              onChange={(e) =>
                setValue({ ...value, retentionDays: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>Minimum disk space, GiB</span>
            <input
              required
              type="number"
              min={1}
              max={10000}
              value={value.minimumFreeGiB}
              onChange={(e) =>
                setValue({ ...value, minimumFreeGiB: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <p className="hint">
          Retention applies after successful backups and recent restore
          verification. Unreferenced data is reclaimed during weekly
          maintenance. A backup can temporarily interrupt Supabase availability.
        </p>
        <div className="dialog-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function InstallService({
  data,
  pending,
  install,
}: {
  data: Extract<BackupOverview, { kind: "not_installed" }>;
  pending: boolean;
  install: (mount: string, project: string) => void;
}) {
  const [mount, setMount] = useState(data.mount);
  const [project, setProject] = useState(data.project);
  return (
    <section className="panel server-backup-install">
      <Tile icon="backup" hue="backup" size="xl" />
      <h2>
        {data.legacy
          ? "Connect your existing backups"
          : "Set up server backups"}
      </h2>
      <p>
        {data.legacy
          ? "Your backup service is already installed. Connect it to Homebase to view snapshots and manage its schedule. Existing files, encryption credentials, and scheduling are preserved."
          : "Install the bundled backup agent on this server. It uses a dedicated ext4 disk and protects your Supabase database and Storage objects together."}
      </p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          install(mount, project);
        }}
      >
        <label className="field">
          <span>Mounted backup disk</span>
          <input
            required
            value={mount}
            readOnly={data.legacy}
            onChange={(e) => setMount(e.target.value)}
            placeholder="/srv/backups"
          />
          <small className="hint">
            Must already be mounted read-write as ext4. Installation never
            formats a disk.
          </small>
        </label>
        <label className="field">
          <span>Supabase project ID</span>
          <input
            value={project}
            readOnly={data.legacy}
            onChange={(e) => setProject(e.target.value)}
            placeholder="Automatically detect a single Supabase project"
          />
          <small className="hint">
            Required when the server has more than one Supabase deployment.
          </small>
        </label>
        <Button type="submit" disabled={pending}>
          <Icon name="shield" size={16} />
          {pending
            ? "Connecting backup service…"
            : data.legacy
              ? "Connect existing backups"
              : "Install backup service"}
        </Button>
        <p className="hint">
          Uses the server connection already managed by Coolify. Requires root
          or passwordless sudo. Restic is installed if missing. No backup runs
          until you start one or enable its schedule.
        </p>
      </form>
    </section>
  );
}
