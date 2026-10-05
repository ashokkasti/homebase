"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { taskListSchema, type Resource, type Task } from "@/lib/schemas";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import {
  Empty,
  Loading,
  SectionHeading,
  Segmented,
  Switch,
  Tile,
  formatDate,
  timeAgo,
} from "../kit";
import { useConfirm } from "../confirm";
import { okSchema } from "../workspace";

const presets = [
  { value: "every_minute", label: "Every minute" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];
function describe(frequency: string) {
  const preset = presets.find((p) => p.value === frequency);
  if (preset) return preset.label;
  const [m, h, dom, mon, dow] = frequency.split(/\s+/);
  if (
    m &&
    h &&
    dom === "*" &&
    mon === "*" &&
    dow === "*" &&
    /^\d+$/.test(m) &&
    /^\d+$/.test(h)
  )
    return `Daily at ${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
  if (m === "0" && h === "*") return "Hourly";
  return "Custom schedule";
}
type Draft = {
  id?: string;
  name: string;
  command: string;
  frequency: string;
  container: string;
  timeout: number;
  enabled: boolean;
};
const blank: Draft = {
  name: "",
  command: "",
  frequency: "daily",
  container: "",
  timeout: 300,
  enabled: true,
};

export function TasksTab({ resource }: { resource: Resource }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const key = ["tasks", resource.kind, resource.id];
  const path = `resources/${resource.kind}/${encodeURIComponent(resource.id)}/tasks`;
  const query = useQuery({
    queryKey: key,
    queryFn: () => api(path, taskListSchema),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (body: unknown) => api(path, okSchema, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
    onError: (error) => toast.error(error.message),
  });
  async function remove(task: Task) {
    const ok = await confirm({
      title: `Delete “${task.name}”?`,
      description: "The schedule and its execution history are removed.",
      confirmLabel: "Delete task",
      icon: "trash",
    });
    if (ok)
      mutation.mutate(
        { op: "delete", id: task.id },
        { onSuccess: () => toast.success("Task deleted") },
      );
  }
  if (query.isLoading) return <Loading rows={3} />;
  if (query.isError)
    return (
      <Empty
        icon="task"
        hue="red"
        title="Tasks unavailable"
        description={query.error.message}
        action={() => void query.refetch()}
        actionLabel="Try again"
        compact
      />
    );
  const tasks = query.data?.tasks ?? [];
  return (
    <section className="panel">
      <SectionHeading
        title="Scheduled tasks"
        count={tasks.length}
        action={
          !draft && (
            <Button size="sm" onClick={() => setDraft(blank)}>
              <Icon name="plus" size={15} />
              New task
            </Button>
          )
        }
      />
      {draft && (
        <TaskForm
          draft={draft}
          resource={resource}
          pending={mutation.isPending}
          onCancel={() => setDraft(null)}
          onSubmit={(value) =>
            mutation.mutate(
              { op: value.id ? "update" : "create", ...value },
              {
                onSuccess: () => {
                  toast.success(value.id ? "Task updated" : "Task scheduled");
                  setDraft(null);
                },
              },
            )
          }
        />
      )}
      {tasks.length === 0 && !draft ? (
        <Empty
          icon="task"
          hue="amber"
          title="No scheduled tasks"
          description="Run commands inside the container on a schedule: migrations, cleanups, reports."
          action={() => setDraft(blank)}
          actionLabel="Schedule a task"
          compact
        />
      ) : (
        <div className="rows">
          {tasks.map((task) => {
            const last = task.executions[0];
            return (
              <div
                key={task.id}
                className={`task ${task.enabled ? "" : "task-off"}`}
              >
                <div className="row">
                  <button
                    className="row-main row-button"
                    onClick={() =>
                      setExpanded(expanded === task.id ? null : task.id)
                    }
                  >
                    <Tile
                      icon="task"
                      hue={task.enabled ? "amber" : "neutral"}
                      size="sm"
                    />
                    <span className="row-text">
                      <span className="row-title">{task.name}</span>
                      <span className="row-sub mono">$ {task.command}</span>
                    </span>
                  </button>
                  <span className="meta-chip mono" title={task.frequency}>
                    <Icon name="calendar" size={13} />
                    {describe(task.frequency)}
                  </span>
                  {last && (
                    <span
                      className={`pill ${/success|finished/i.test(last.status) ? "s-running" : /fail|error/i.test(last.status) ? "s-failed" : "s-deploying"}`}
                      title={formatDate(last.date)}
                    >
                      <span className="dot" />
                      {timeAgo(last.date)}
                    </span>
                  )}
                  <Switch
                    checked={task.enabled}
                    label={`${task.enabled ? "Disable" : "Enable"} ${task.name}`}
                    onChange={(on) =>
                      mutation.mutate({
                        op: on ? "enable" : "disable",
                        id: task.id,
                      })
                    }
                  />
                  <button
                    className="icon-button"
                    title="Run now"
                    aria-label={`Run ${task.name} now`}
                    onClick={() =>
                      mutation.mutate(
                        { op: "run", id: task.id },
                        {
                          onSuccess: () => {
                            toast.success(`${task.name} started`);
                            setExpanded(task.id);
                          },
                        },
                      )
                    }
                  >
                    <Icon name="play" size={17} />
                  </button>
                  <button
                    className="icon-button"
                    title="Edit"
                    aria-label={`Edit ${task.name}`}
                    onClick={() =>
                      setDraft({ ...task, timeout: task.timeout ?? 300 })
                    }
                  >
                    <Icon name="pen" size={16} />
                  </button>
                  <button
                    className="icon-button danger-hover"
                    title="Delete"
                    aria-label={`Delete ${task.name}`}
                    onClick={() => void remove(task)}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
                {expanded === task.id && (
                  <div className="executions">
                    {task.executions.length === 0 && (
                      <p className="muted small">No runs yet.</p>
                    )}
                    {task.executions.map((e) => (
                      <div className="execution" key={e.id}>
                        <span
                          className={`status-dot ${/success|finished/i.test(e.status) ? "s-running" : /fail|error/i.test(e.status) ? "s-failed" : "s-deploying"}`}
                        />
                        <span className="mono">{formatDate(e.date)}</span>
                        <span className="muted mono">
                          {e.duration ? `${e.duration}s` : ""}
                        </span>
                        {e.message && <pre>{e.message}</pre>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TaskForm({
  draft,
  resource,
  pending,
  onCancel,
  onSubmit,
}: {
  draft: Draft;
  resource: Resource;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (value: Draft) => void;
}) {
  const [value, setValue] = useState(draft);
  const preset = presets.some((p) => p.value === value.frequency)
    ? value.frequency
    : "custom";
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      <div className="form-grid">
        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            required
            placeholder="Nightly cleanup"
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Command</span>
          <input
            className="mono"
            required
            placeholder="php artisan schedule:run"
            value={value.command}
            onChange={(e) => setValue({ ...value, command: e.target.value })}
          />
        </label>
      </div>
      <div className="field">
        <span>Schedule</span>
        <Segmented
          value={preset}
          onChange={(next) =>
            setValue({
              ...value,
              frequency: next === "custom" ? "0 3 * * *" : next,
            })
          }
          options={[...presets, { value: "custom", label: "Cron" }]}
        />
        {preset === "custom" && (
          <input
            className="mono"
            required
            placeholder="0 3 * * *"
            value={value.frequency}
            onChange={(e) => setValue({ ...value, frequency: e.target.value })}
          />
        )}
        <small className="hint">
          {describe(value.frequency)} · minute hour day month weekday
        </small>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>
            Container {resource.kind === "service" ? "" : "(optional)"}
          </span>
          {resource.kind === "service" ? (
            <select
              value={value.container}
              onChange={(e) =>
                setValue({ ...value, container: e.target.value })
              }
            >
              <option value="">Main container</option>
              {resource.components.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="mono"
              placeholder="Main container"
              value={value.container}
              onChange={(e) =>
                setValue({ ...value, container: e.target.value })
              }
            />
          )}
        </label>
        <label className="field">
          <span>Timeout (seconds)</span>
          <input
            type="number"
            min={1}
            max={36000}
            value={value.timeout}
            onChange={(e) =>
              setValue({ ...value, timeout: Number(e.target.value) || 300 })
            }
          />
        </label>
      </div>
      <div className="dialog-actions">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : value.id ? "Save task" : "Schedule task"}
        </Button>
      </div>
    </form>
  );
}
