"use client";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { envListSchema, type EnvVar, type Resource } from "@/lib/schemas";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import { copyText, Empty, Loading, SearchField, Segmented } from "../kit";
import { useConfirm } from "../confirm";
import { okSchema, useWorkspace } from "../workspace";
import { ApplyBanner } from "./apply-banner";

type EnvInput =
  | {
      op: "create" | "update";
      key: string;
      value: string;
      isPreview: boolean;
      isLiteral: boolean;
      isMultiline: boolean;
    }
  | { op: "delete"; id: string }
  | { op: "bulk"; entries: { key: string; value: string }[] };

function serialize(envs: EnvVar[]) {
  return envs
    .map(
      (e) =>
        `${e.key}=${/[\s"'#\n]/.test(e.value) ? JSON.stringify(e.value) : e.value}`,
    )
    .join("\n");
}
export function parseDotenv(text: string) {
  const entries: { key: string; value: string }[] = [];
  const errors: number[] = [];
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(
      line,
    );
    if (!match) {
      errors.push(index + 1);
      return;
    }
    let value = match[2] ?? "";
    if (/^".*"$/.test(value)) {
      try {
        value = z.string().parse(JSON.parse(value));
      } catch {
        value = value.slice(1, -1);
      }
    } else if (/^'.*'$/.test(value)) value = value.slice(1, -1);
    entries.push({ key: match[1] ?? "", value });
  });
  return { entries, errors };
}

export function EnvironmentTab({ resource }: { resource: Resource }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { run } = useWorkspace();
  const key = ["envs", resource.kind, resource.id];
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      api(
        `resources/${resource.kind}/${encodeURIComponent(resource.id)}/envs`,
        envListSchema,
      ),
  });
  const [scope, setScope] = useState<"production" | "preview">("production");
  const [mode, setMode] = useState<"table" | "bulk">("table");
  const [search, setSearch] = useState("");
  const [reveal, setReveal] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [bulkText, setBulkText] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (inputs: EnvInput[]) =>
      inputs.reduce<Promise<unknown>>(
        (chain, input) =>
          chain.then(() =>
            api(
              `resources/${resource.kind}/${encodeURIComponent(resource.id)}/envs`,
              okSchema,
              input,
            ),
          ),
        Promise.resolve(),
      ),
    onSuccess: () => {
      setDirty(true);
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error) => {
      toast.error(error.message);
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const envs = useMemo(() => query.data?.envs ?? [], [query.data]);
  const hasPreview = envs.some((e) => e.isPreview);
  const scoped = envs.filter((e) => e.isPreview === (scope === "preview"));
  const term = search.toLowerCase();
  const visible = scoped.filter(
    (e) =>
      e.key.toLowerCase().includes(term) ||
      (reveal && e.value.toLowerCase().includes(term)),
  );
  async function remove(env: EnvVar) {
    const ok = await confirm({
      title: `Delete ${env.key}?`,
      description: "The variable is removed on the next deployment.",
      confirmLabel: "Delete",
      icon: "trash",
    });
    if (ok)
      mutation.mutate([{ op: "delete", id: env.id }], {
        onSuccess: () => toast.success(`${env.key} deleted`),
      });
  }
  async function saveBulk() {
    if (bulkText === null) return;
    const { entries, errors } = parseDotenv(bulkText);
    if (errors.length) {
      toast.error(`Line ${errors.join(", ")} is not KEY=value.`);
      return;
    }
    const keys = new Set(entries.map((e) => e.key));
    const removed = scoped.filter((e) => !keys.has(e.key));
    const changed = entries.filter(
      (entry) => scoped.find((e) => e.key === entry.key)?.value !== entry.value,
    );
    if (!changed.length && !removed.length) {
      toast.info("No changes to save.");
      return;
    }
    if (removed.length) {
      const ok = await confirm({
        title: `Remove ${removed.length} variable${removed.length > 1 ? "s" : ""}?`,
        description: removed.map((e) => e.key).join(", "),
        confirmLabel: "Save and remove",
        icon: "trash",
      });
      if (!ok) return;
    }
    mutation.mutate(
      [
        ...(changed.length ? [{ op: "bulk" as const, entries: changed }] : []),
        ...removed.map((e) => ({ op: "delete" as const, id: e.id })),
      ],
      {
        onSuccess: () => {
          toast.success(`${changed.length} saved · ${removed.length} removed`);
          setBulkText(null);
          setMode("table");
        },
      },
    );
  }
  if (query.isLoading) return <Loading rows={4} />;
  if (query.isError)
    return (
      <Empty
        icon="key"
        hue="red"
        title="Variables unavailable"
        description={query.error.message}
        action={() => void query.refetch()}
        actionLabel="Try again"
        compact
      />
    );
  return (
    <div className="stack">
      {dirty && (
        <ApplyBanner
          resource={resource}
          onApply={() => {
            setDirty(false);
            void run(
              resource,
              resource.kind === "database" ? "restart" : "deploy",
            );
          }}
        />
      )}
      <div className="toolbar">
        <div className="toolbar-left">
          <Segmented
            value={mode}
            onChange={(next) => {
              setMode(next);
              setBulkText(next === "bulk" ? serialize(scoped) : null);
              setAdding(false);
            }}
            label="Editor mode"
            options={[
              {
                value: "table",
                label: (
                  <>
                    <Icon name="list" size={14} />
                    Table
                  </>
                ),
              },
              {
                value: "bulk",
                label: (
                  <>
                    <Icon name="file" size={14} />
                    .env
                  </>
                ),
              },
            ]}
          />
          {(hasPreview || resource.kind === "app") && (
            <Segmented
              value={scope}
              onChange={(next) => {
                setScope(next);
                if (mode === "bulk")
                  setBulkText(
                    serialize(
                      envs.filter((e) => e.isPreview === (next === "preview")),
                    ),
                  );
              }}
              label="Scope"
              options={[
                {
                  value: "production",
                  label: "Production",
                  count: envs.filter((e) => !e.isPreview).length,
                },
                {
                  value: "preview",
                  label: "Preview",
                  count: envs.filter((e) => e.isPreview).length,
                },
              ]}
            />
          )}
        </div>
        <div className="toolbar-right">
          {mode === "table" && (
            <>
              <SearchField
                value={search}
                onChange={setSearch}
                placeholder="Filter variables…"
              />
              <button
                className={`icon-button ${reveal ? "toggled" : ""}`}
                title={reveal ? "Hide values" : "Reveal values"}
                aria-pressed={reveal}
                aria-label="Reveal all values"
                onClick={() => setReveal(!reveal)}
              >
                <Icon name={reveal ? "eyeClosed" : "eye"} size={17} />
              </button>
              <Button onClick={() => setAdding(true)} disabled={adding}>
                <Icon name="plus" size={16} />
                Add variable
              </Button>
            </>
          )}
        </div>
      </div>
      {mode === "bulk" ? (
        <section className="panel bulk-editor">
          <div className="bulk-head">
            <span>
              Edit {scope} variables as a <code>.env</code> file. Removed lines
              delete the variable.
            </span>
            <span className="mono muted">
              {parseDotenv(bulkText ?? "").entries.length} keys
            </span>
          </div>
          <textarea
            className="code-input"
            spellCheck={false}
            value={bulkText ?? ""}
            onChange={(e) => setBulkText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                void saveBulk();
              }
            }}
            rows={Math.min(
              28,
              Math.max(10, (bulkText ?? "").split("\n").length + 2),
            )}
          />
          <div className="bulk-foot">
            <Button
              variant="ghost"
              onClick={() => setBulkText(serialize(scoped))}
            >
              Reset
            </Button>
            <Button
              onClick={() => void saveBulk()}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Saving…" : "Save variables"}
              <span className="kbd-group">
                <kbd className="kbd">⌘</kbd>
                <kbd className="kbd">S</kbd>
              </span>
            </Button>
          </div>
        </section>
      ) : (
        <section className="panel panel-flush">
          {adding && (
            <EnvForm
              initial={{
                key: "",
                value: "",
                isPreview: scope === "preview",
                isLiteral: false,
                isMultiline: false,
              }}
              pending={mutation.isPending}
              onCancel={() => setAdding(false)}
              onPasteBulk={(text) => {
                setAdding(false);
                setMode("bulk");
                setBulkText(`${serialize(scoped)}\n${text}`.trim());
              }}
              onSubmit={(value) =>
                mutation.mutate([{ op: "create", ...value }], {
                  onSuccess: () => {
                    toast.success(`${value.key} added`);
                    setAdding(false);
                  },
                })
              }
            />
          )}
          {visible.length === 0 && !adding ? (
            <Empty
              icon="key"
              hue="accent"
              title={
                scoped.length ? "No matching variables" : "No variables yet"
              }
              description="Variables are injected at build and runtime. Paste a .env file to add many at once."
              action={() => setAdding(true)}
              actionLabel="Add variable"
              compact
            />
          ) : (
            <div className="env-list">
              {visible.map((env) =>
                editing === env.id ? (
                  <EnvForm
                    key={env.id}
                    initial={env}
                    lockKey
                    pending={mutation.isPending}
                    onCancel={() => setEditing(null)}
                    onSubmit={(value) =>
                      mutation.mutate([{ op: "update", ...value }], {
                        onSuccess: () => {
                          toast.success(`${value.key} updated`);
                          setEditing(null);
                        },
                      })
                    }
                  />
                ) : (
                  <div className="env-row" key={env.id}>
                    <span className="env-key mono">{env.key}</span>
                    <button
                      className={`env-value mono ${reveal || revealed.has(env.id) ? "" : "masked"}`}
                      title="Click to reveal"
                      onClick={() =>
                        setRevealed((set) => {
                          const next = new Set(set);
                          if (next.has(env.id)) next.delete(env.id);
                          else next.add(env.id);
                          return next;
                        })
                      }
                    >
                      {env.isShownOnce
                        ? "hidden after creation"
                        : reveal || revealed.has(env.id)
                          ? env.value || <span className="muted">empty</span>
                          : "•".repeat(
                              Math.min(24, Math.max(8, env.value.length)),
                            )}
                    </button>
                    <span className="env-flags">
                      {env.isLiteral && (
                        <span className="meta-chip">literal</span>
                      )}
                      {env.isMultiline && (
                        <span className="meta-chip">multiline</span>
                      )}
                      {env.isShownOnce && (
                        <span className="meta-chip">locked</span>
                      )}
                    </span>
                    <span className="env-actions">
                      <button
                        className="icon-button"
                        title="Copy value"
                        aria-label={`Copy ${env.key}`}
                        onClick={() =>
                          void copyText(env.value, `${env.key} copied`)
                        }
                      >
                        <Icon name="copy" size={16} />
                      </button>
                      <button
                        className="icon-button"
                        title="Edit"
                        aria-label={`Edit ${env.key}`}
                        onClick={() => setEditing(env.id)}
                      >
                        <Icon name="pen" size={16} />
                      </button>
                      <button
                        className="icon-button danger-hover"
                        title="Delete"
                        aria-label={`Delete ${env.key}`}
                        onClick={() => void remove(env)}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </span>
                  </div>
                ),
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function EnvForm({
  initial,
  lockKey = false,
  pending,
  onCancel,
  onSubmit,
  onPasteBulk,
}: {
  initial: Pick<
    EnvVar,
    "key" | "value" | "isPreview" | "isLiteral" | "isMultiline"
  >;
  lockKey?: boolean;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (value: {
    key: string;
    value: string;
    isPreview: boolean;
    isLiteral: boolean;
    isMultiline: boolean;
  }) => void;
  onPasteBulk?: (text: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="env-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...value, key: value.key.trim() });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <input
        className="mono"
        autoFocus={!lockKey}
        readOnly={lockKey}
        placeholder="KEY"
        value={value.key}
        required
        pattern="[A-Za-z_][A-Za-z0-9_.\-]*"
        onChange={(e) => setValue({ ...value, key: e.target.value })}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (onPasteBulk && /\n/.test(text.trim()) && /=/.test(text)) {
            e.preventDefault();
            onPasteBulk(text);
          } else if (/^[A-Za-z_][\w.-]*=/.test(text) && !text.includes("\n")) {
            e.preventDefault();
            const [k, ...rest] = text.split("=");
            setValue({ ...value, key: k ?? "", value: rest.join("=") });
          }
        }}
      />
      {value.isMultiline ? (
        <textarea
          className="mono"
          autoFocus={lockKey}
          placeholder="value"
          rows={4}
          value={value.value}
          onChange={(e) => setValue({ ...value, value: e.target.value })}
        />
      ) : (
        <input
          className="mono"
          autoFocus={lockKey}
          placeholder="value"
          value={value.value}
          onChange={(e) => setValue({ ...value, value: e.target.value })}
        />
      )}
      <div className="env-form-foot">
        <label className="check">
          <input
            type="checkbox"
            checked={value.isLiteral}
            onChange={(e) =>
              setValue({ ...value, isLiteral: e.target.checked })
            }
          />
          Literal
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={value.isMultiline}
            onChange={(e) =>
              setValue({ ...value, isMultiline: e.target.checked })
            }
          />
          Multiline
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={value.isPreview}
            disabled={lockKey}
            onChange={(e) =>
              setValue({ ...value, isPreview: e.target.checked })
            }
          />
          Preview only
        </label>
        <span className="console-spacer" />
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending || !value.key.trim()}>
          {pending ? "Saving…" : lockKey ? "Save" : "Add"}
        </Button>
      </div>
    </form>
  );
}
