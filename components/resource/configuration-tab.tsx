"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { configFields, type FieldDef } from "@/lib/config-fields";
import {
  configSchema,
  type Resource,
  type ResourceConfig,
} from "@/lib/schemas";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import { CopyButton, Empty, formatDate, Keys, Loading, Switch } from "../kit";
import { useWorkspace } from "../workspace";

type Fields = ResourceConfig["fields"];
const saveResult = z.object({
  ok: z.boolean(),
  deploymentId: z.string().optional(),
});

export function ConfigurationTab({ resource }: { resource: Resource }) {
  const queryClient = useQueryClient();
  const { run, followDeployment, invalidate } = useWorkspace();
  const key = ["config", resource.kind, resource.id];
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      api(
        `resources/${resource.kind}/${encodeURIComponent(resource.id)}/config`,
        configSchema,
      ),
  });
  const [draft, setDraft] = useState<Fields>({});
  const original = useMemo(() => query.data?.fields ?? {}, [query.data]);
  useEffect(() => setDraft(original), [original]);
  const changed = Object.keys(draft).filter((k) => draft[k] !== original[k]);
  const mutation = useMutation({
    mutationFn: (redeploy: boolean) =>
      api(
        `resources/${resource.kind}/${encodeURIComponent(resource.id)}/config`,
        saveResult,
        {
          fields: Object.fromEntries(changed.map((k) => [k, draft[k] ?? null])),
          redeploy,
        },
      ),
    onSuccess: (result, redeploy) => {
      toast.success(
        `${changed.length} setting${changed.length === 1 ? "" : "s"} saved`,
      );
      if (redeploy) followDeployment(result.deploymentId, resource.name);
      void queryClient.invalidateQueries({ queryKey: key });
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (changed.length && !mutation.isPending) mutation.mutate(false);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  if (query.isLoading) return <Loading rows={6} />;
  if (query.isError)
    return (
      <Empty
        icon="tuning"
        hue="red"
        title="Configuration unavailable"
        description={query.error.message}
        action={() => void query.refetch()}
        actionLabel="Try again"
        compact
      />
    );
  const visible = configFields[resource.kind].filter(
    (f) => !f.when || f.when(draft),
  );
  const sections = [...new Set(visible.map((f) => f.section))];
  const info = Object.entries(query.data?.info ?? {});
  return (
    <div className="config">
      <div className="config-main">
        {sections.map((section) => (
          <section className="config-section" key={section}>
            <h2>{section}</h2>
            <div className="config-grid">
              {visible
                .filter((f) => f.section === section)
                .map((field) => (
                  <ConfigField
                    key={field.key}
                    field={field}
                    value={draft[field.key] ?? null}
                    changed={draft[field.key] !== original[field.key]}
                    onChange={(value) =>
                      setDraft((d) => ({ ...d, [field.key]: value }))
                    }
                  />
                ))}
            </div>
          </section>
        ))}
        <section className="config-section danger-zone">
          <h2>Danger zone</h2>
          <div className="danger-row">
            <span className="row-text">
              <span className="row-title">
                Delete this{" "}
                {resource.kind === "app" ? "application" : resource.kind}
              </span>
              <span className="row-sub">
                Removes containers and configuration. Volumes are optional.
              </span>
            </span>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void run(resource, "delete")}
            >
              <Icon name="trash" size={15} />
              Delete…
            </Button>
          </div>
        </section>
      </div>
      <aside className="config-aside">
        <div className="info-card">
          <h3>Details</h3>
          {info.length === 0 && (
            <p className="muted small">No extra details.</p>
          )}
          {info.map(([label, value]) => (
            <InfoRow key={label} label={label} value={value} />
          ))}
        </div>
      </aside>
      {changed.length > 0 &&
        createPortal(
          <div className="save-bar" role="region" aria-label="Unsaved changes">
            <span className="save-dot" />
            <span>
              <strong className="mono">{changed.length}</strong> unsaved change
              {changed.length === 1 ? "" : "s"}
            </span>
            <span className="console-spacer" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraft(original)}
              disabled={mutation.isPending}
            >
              Discard
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => mutation.mutate(false)}
              disabled={mutation.isPending}
            >
              Save
              <Keys keys={["⌘", "S"]} />
            </Button>
            <Button
              size="sm"
              onClick={() => mutation.mutate(true)}
              disabled={mutation.isPending}
            >
              <Icon
                name={resource.kind === "database" ? "restart" : "deploy"}
                size={15}
              />
              {mutation.isPending
                ? "Saving…"
                : resource.kind === "database"
                  ? "Save & restart"
                  : "Save & redeploy"}
            </Button>
          </div>,
          document.body,
        )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const secret = /url/i.test(label) && /:\/\/[^@\s]*:[^@\s]*@/.test(value);
  const [show, setShow] = useState(!secret);
  const display = label === "Created" ? formatDate(value) : value;
  return (
    <div className="info-row">
      <span>{label}</span>
      <span className="info-value mono">
        <span className="truncate" title={show ? display : undefined}>
          {show ? display : display.replace(/(:\/\/[^:]+:)[^@]+@/, "$1••••••@")}
        </span>
        {secret && (
          <button
            className="icon-button icon-button-sm"
            aria-label={show ? "Hide" : "Reveal"}
            onClick={() => setShow(!show)}
          >
            <Icon name={show ? "eyeClosed" : "eye"} size={15} />
          </button>
        )}
        <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
      </span>
    </div>
  );
}

function ConfigField({
  field,
  value,
  changed,
  onChange,
}: {
  field: FieldDef;
  value: Fields[string];
  changed: boolean;
  onChange: (value: Fields[string]) => void;
}) {
  const id = `field-${field.key}`;
  const className = `config-field ${field.wide || field.type === "code" || field.type === "textarea" ? "wide" : ""} ${changed ? "changed" : ""}`;
  if (field.type === "bool")
    return (
      <div className={`${className} bool-field`}>
        <span className="row-text">
          <label htmlFor={id} className="row-title">
            {field.label}
          </label>
          {field.help && <span className="row-sub wrap">{field.help}</span>}
        </span>
        <Switch
          checked={value === true}
          onChange={onChange}
          label={field.label}
        />
      </div>
    );
  return (
    <label className={className} htmlFor={id}>
      <span className="field-label">
        {field.label}
        {changed && <span className="changed-dot" title="Changed" />}
      </span>
      {field.type === "select" ? (
        <select
          id={id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          {!field.options?.some((o) => o.value === value) && (
            <option value={String(value ?? "")}>{String(value || "—")}</option>
          )}
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === "code" || field.type === "textarea" ? (
        <textarea
          id={id}
          className={
            field.type === "code" ? "code-input" : field.mono ? "mono" : ""
          }
          spellCheck={false}
          rows={
            field.type === "code"
              ? Math.min(
                  30,
                  Math.max(12, String(value ?? "").split("\n").length + 1),
                )
              : 3
          }
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (field.type === "code" && e.key === "Tab") {
              e.preventDefault();
              const el = e.currentTarget;
              const start = el.selectionStart;
              const next = `${el.value.slice(0, start)}  ${el.value.slice(el.selectionEnd)}`;
              onChange(next);
              requestAnimationFrame(() =>
                el.setSelectionRange(start + 2, start + 2),
              );
            }
          }}
        />
      ) : (
        <input
          id={id}
          className={field.mono ? "mono" : ""}
          type={field.type === "number" ? "number" : "text"}
          value={value === null ? "" : String(value)}
          placeholder={field.placeholder}
          onChange={(e) =>
            onChange(
              field.type === "number"
                ? e.target.value === ""
                  ? null
                  : Number(e.target.value)
                : e.target.value,
            )
          }
        />
      )}
      {field.help && <small className="hint">{field.help}</small>}
    </label>
  );
}
