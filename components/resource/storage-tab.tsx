"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { storageListSchema, type Resource, type Storage } from "@/lib/schemas";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import {
  CopyButton,
  Empty,
  Loading,
  SectionHeading,
  Segmented,
  Tile,
} from "../kit";
import { useConfirm } from "../confirm";
import { okSchema } from "../workspace";

export function StorageTab({ resource }: { resource: Resource }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const key = ["storages", resource.kind, resource.id];
  const path = `resources/${resource.kind}/${encodeURIComponent(resource.id)}/storages`;
  const query = useQuery({
    queryKey: key,
    queryFn: () => api(path, storageListSchema),
  });
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({
    type: "persistent" as Storage["type"],
    name: "",
    mountPath: "",
    content: "",
  });
  const mutation = useMutation({
    mutationFn: (body: unknown) => api(path, okSchema, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
    onError: (error) => toast.error(error.message),
  });
  async function remove(storage: Storage) {
    const ok = await confirm({
      title: `Remove ${storage.name || storage.mountPath}?`,
      description:
        storage.type === "persistent"
          ? "The mount is removed from the container. Data in the Docker volume may be lost on cleanup."
          : "The file mount is removed from the container.",
      confirmLabel: "Remove",
      icon: "trash",
    });
    if (ok)
      mutation.mutate(
        { op: "delete", id: storage.id },
        { onSuccess: () => toast.success("Storage removed") },
      );
  }
  if (query.isLoading) return <Loading rows={3} />;
  if (query.isError)
    return (
      <Empty
        icon="volume"
        hue="red"
        title="Storage unavailable"
        description={query.error.message}
        action={() => void query.refetch()}
        actionLabel="Try again"
        compact
      />
    );
  const storages = query.data?.storages ?? [];
  return (
    <div className="stack">
      <section className="panel">
        <SectionHeading
          title="Mounts"
          count={storages.length}
          action={
            !adding && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Icon name="plus" size={15} />
                Add mount
              </Button>
            )
          }
        />
        {adding && (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate(
                { op: "create", ...form },
                {
                  onSuccess: () => {
                    toast.success("Mount added. Redeploy to apply.");
                    setAdding(false);
                    setForm({
                      type: "persistent",
                      name: "",
                      mountPath: "",
                      content: "",
                    });
                  },
                },
              );
            }}
          >
            <Segmented
              value={form.type}
              onChange={(type) => setForm({ ...form, type })}
              label="Mount type"
              options={[
                {
                  value: "persistent",
                  label: (
                    <>
                      <Icon name="volume" size={14} />
                      Volume
                    </>
                  ),
                },
                {
                  value: "file",
                  label: (
                    <>
                      <Icon name="file" size={14} />
                      File
                    </>
                  ),
                },
              ]}
            />
            <div className="form-grid">
              {form.type === "persistent" && (
                <label className="field">
                  <span>Volume name</span>
                  <input
                    className="mono"
                    placeholder={`${resource.id}-data`}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </label>
              )}
              <label className="field">
                <span>Path in container</span>
                <input
                  className="mono"
                  required
                  placeholder={
                    form.type === "file" ? "/app/config.json" : "/data"
                  }
                  value={form.mountPath}
                  onChange={(e) =>
                    setForm({ ...form, mountPath: e.target.value })
                  }
                />
              </label>
            </div>
            {form.type === "file" && (
              <label className="field">
                <span>File content</span>
                <textarea
                  className="code-input"
                  rows={8}
                  spellCheck={false}
                  value={form.content}
                  onChange={(e) =>
                    setForm({ ...form, content: e.target.value })
                  }
                />
              </label>
            )}
            <div className="dialog-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Adding…" : "Add mount"}
              </Button>
            </div>
          </form>
        )}
        {storages.length === 0 && !adding ? (
          <Empty
            icon="volume"
            hue="server"
            title="No mounts"
            description="Containers lose files on redeploy unless you mount a volume."
            action={() => setAdding(true)}
            actionLabel="Add a volume"
            compact
          />
        ) : (
          <div className="rows">
            {storages.map((s) => (
              <div key={s.id} className="storage">
                <div className="row">
                  <span className="row-main">
                    <Tile
                      icon={s.type === "file" ? "file" : "volume"}
                      hue={s.type === "file" ? "accent" : "server"}
                      size="sm"
                    />
                    <span className="row-text">
                      <span className="row-title">{s.name || s.mountPath}</span>
                      <span className="row-sub mono">
                        {s.mountPath}
                        {s.hostPath && ` ← ${s.hostPath}`}
                      </span>
                    </span>
                  </span>
                  <span className="meta-chip">
                    {s.type === "file" ? "File" : "Volume"}
                  </span>
                  {s.readOnly && (
                    <span
                      className="meta-chip"
                      title="Defined by the compose file"
                    >
                      <Icon name="lock" size={13} />
                      compose
                    </span>
                  )}
                  <CopyButton value={s.mountPath} label="Copy mount path" />
                  {s.type === "file" && s.content && (
                    <button
                      className={`icon-button ${open === s.id ? "toggled" : ""}`}
                      aria-label="Show content"
                      onClick={() => setOpen(open === s.id ? null : s.id)}
                    >
                      <Icon name="eye" size={16} />
                    </button>
                  )}
                  {!s.readOnly && (
                    <button
                      className="icon-button danger-hover"
                      aria-label={`Remove ${s.mountPath}`}
                      onClick={() => void remove(s)}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  )}
                </div>
                {open === s.id && (
                  <pre className="file-preview">{s.content}</pre>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
