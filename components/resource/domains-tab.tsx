"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  dnsResultSchema,
  domainSettingsSchema,
  type DnsResult,
  type Domain,
  type DomainSettings,
  type Resource,
} from "@/lib/schemas";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import {
  copyText,
  Empty,
  Loading,
  Menu,
  MenuItem,
  MenuLabel,
  SearchField,
  Segmented,
  Switch,
  Tile,
} from "../kit";
import { useConfirm } from "../confirm";
import { okSchema, useWorkspace } from "../workspace";
import { ApplyBanner } from "./apply-banner";
import { DomainSuggestions } from "../domain-suggestions";

type Draft = Pick<Domain, "host" | "scheme" | "port" | "path" | "indexed">;
type Settings = Pick<DomainSettings, "forceHttps" | "redirect"> & {
  domains: Draft[];
};
const blank: Draft = {
  host: "",
  scheme: "https",
  port: "",
  path: "",
  indexed: true,
};
const dnsCopy: Record<
  DnsResult["status"],
  { label: string; tone: string; hint: string }
> = {
  ok: {
    label: "Points here",
    tone: "s-running",
    hint: "Resolves to this server.",
  },
  proxied: {
    label: "Proxied",
    tone: "s-deploying",
    hint: "Behind Cloudflare. The origin can’t be verified from DNS.",
  },
  mismatch: {
    label: "Elsewhere",
    tone: "s-warn",
    hint: "Resolves to an address that isn’t one of your servers.",
  },
  missing: {
    label: "No record",
    tone: "s-failed",
    hint: "No A, AAAA or CNAME record found.",
  },
  error: {
    label: "Lookup failed",
    tone: "s-failed",
    hint: "DNS lookup failed.",
  },
};
function key(d: Pick<Domain, "host" | "port" | "path">) {
  return `${d.host}${d.port}${d.path}`;
}
function fromInput(value: string, base: Draft): Draft {
  const raw = value.trim();
  if (!/[:/]/.test(raw)) return { ...base, host: raw.toLowerCase() };
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    return {
      ...base,
      host: url.hostname.toLowerCase(),
      scheme: url.protocol === "http:" ? "http" : "https",
      port: url.port,
      path: url.pathname === "/" ? "" : url.pathname,
    };
  } catch {
    return { ...base, host: raw };
  }
}

export function DomainsTab({ resource }: { resource: Resource }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { run, invalidate, data } = useWorkspace();
  const path = `resources/app/${encodeURIComponent(resource.id)}/domains`;
  const query = useQuery({
    queryKey: ["domains", resource.id],
    queryFn: () => api(path, domainSettingsSchema),
  });
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dns, setDns] = useState<Record<string, DnsResult | "checking">>({});
  const mutation = useMutation({
    mutationFn: (next: Settings) => api(path, okSchema, next),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: ["domains", resource.id] });
      const previous = queryClient.getQueryData<DomainSettings>([
        "domains",
        resource.id,
      ]);
      if (previous)
        queryClient.setQueryData<DomainSettings>(["domains", resource.id], {
          ...previous,
          ...next,
          domains: next.domains.map((d) => ({
            ...d,
            url: `${d.scheme}://${d.host}${d.port ? `:${d.port}` : ""}${d.path}`,
          })),
        });
      return { previous };
    },
    onError: (error, _next, context) => {
      if (context?.previous)
        queryClient.setQueryData(["domains", resource.id], context.previous);
      toast.error(error.message);
    },
    onSuccess: () => {
      setDirty(true);
      invalidate();
    },
    onSettled: () =>
      void queryClient.invalidateQueries({
        queryKey: ["domains", resource.id],
      }),
  });
  async function check(host: string) {
    setDns((s) => ({ ...s, [host]: "checking" }));
    try {
      const result = await api(
        `dns/${encodeURIComponent(host)}`,
        dnsResultSchema,
      );
      setDns((s) => ({ ...s, [host]: result }));
    } catch (error) {
      setDns((s) => ({
        ...s,
        [host]: {
          host,
          status: "error",
          addresses: [],
          cname: [],
          serverIps: [],
        },
      }));
      toast.error(
        error instanceof Error ? error.message : "DNS lookup failed.",
      );
    }
  }
  if (query.isLoading) return <Loading rows={4} />;
  if (query.isError || !query.data)
    return (
      <Empty
        icon="globe"
        hue="red"
        title="Domains unavailable"
        description={query.error?.message ?? ""}
        action={() => void query.refetch()}
        actionLabel="Try again"
        compact
      />
    );
  const settings = query.data;
  const current: Settings = {
    forceHttps: settings.forceHttps,
    redirect: settings.redirect,
    domains: settings.domains.map(
      ({ host, scheme, port, path: p, indexed }) => ({
        host,
        scheme,
        port,
        path: p,
        indexed,
      }),
    ),
  };
  const save = (patch: Partial<Settings>, message?: string) =>
    mutation.mutate(
      { ...current, ...patch },
      { onSuccess: () => message && toast.success(message) },
    );
  const term = search.toLowerCase();
  const visible = settings.domains.filter((d) =>
    d.url.toLowerCase().includes(term),
  );
  const hosts = [...new Set(settings.domains.map((d) => d.host))];
  const serverIp = settings.serverIps[0] ?? data.servers[0]?.ip ?? "";
  return (
    <div className="stack">
      {dirty && (
        <ApplyBanner
          resource={resource}
          onApply={() => {
            setDirty(false);
            void run(resource, "deploy");
          }}
        />
      )}
      {settings.compose && (
        <div className="banner">
          <Icon name="info" size={18} />
          <span>
            This is a Docker Compose app. Coolify assigns its domains per
            compose service; edit those in Coolify.
          </span>
        </div>
      )}
      <section className="panel domain-settings">
        <div className="domain-setting">
          <Tile icon="lock" hue="green" size="sm" />
          <span className="row-text">
            <span className="row-title">Redirect HTTP to HTTPS</span>
            <span className="row-sub wrap">
              Visitors on http:// are sent to https://. Applies to every domain
              below.
            </span>
          </span>
          <Switch
            checked={settings.forceHttps}
            label="Redirect HTTP to HTTPS"
            disabled={mutation.isPending}
            onChange={(forceHttps) =>
              save(
                { forceHttps },
                forceHttps
                  ? "HTTPS redirect enabled"
                  : "HTTPS redirect disabled",
              )
            }
          />
        </div>
        <div className="domain-setting">
          <Tile icon="proxy" hue="accent" size="sm" />
          <span className="row-text">
            <span className="row-title">Domain redirect</span>
            <span className="row-sub wrap">
              Send www and bare-domain visitors to a single canonical address.
            </span>
          </span>
          <Segmented
            value={settings.redirect}
            onChange={(redirect) =>
              save({ redirect }, "Domain redirect updated")
            }
            label="Domain redirect"
            options={[
              { value: "both", label: "Off" },
              { value: "non-www", label: "www → apex" },
              { value: "www", label: "apex → www" },
            ]}
          />
        </div>
      </section>
      <div className="toolbar">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Filter domains…"
        />
        <div className="toolbar-right">
          <Button
            variant="outline"
            disabled={hosts.length === 0}
            onClick={() => {
              hosts.forEach((h) => void check(h));
            }}
          >
            <Icon
              name="refresh"
              size={16}
              className={Object.values(dns).includes("checking") ? "spin" : ""}
            />
            Check all DNS
          </Button>
          <Menu
            label="DNS records to create"
            trigger={
              <button
                className="button button-outline"
                disabled={hosts.length === 0}
              >
                <Icon name="globe" size={16} />
                DNS records
                <Icon name="chevronDown" size={14} />
              </button>
            }
          >
            <MenuLabel>Create at your DNS provider · click to copy</MenuLabel>
            {hosts.map((host) => (
              <MenuItem
                key={host}
                icon="copy"
                onSelect={() =>
                  void copyText(
                    `${host}. A ${serverIp}`,
                    `${host} record copied`,
                  )
                }
              >
                <span className="dns-record mono">
                  <b>A</b> {host} <span className="muted">→</span>{" "}
                  {serverIp || "server IP"}
                </span>
              </MenuItem>
            ))}
          </Menu>
          <Button
            onClick={() => setEditing("new")}
            disabled={editing === "new"}
          >
            <Icon name="plus" size={16} />
            Add domain
          </Button>
        </div>
      </div>
      <section className="panel panel-flush domain-table">
        <div className="domain-row domain-head" aria-hidden>
          <span>Domain</span>
          <span>Protocol</span>
          <span>Port</span>
          <span>Indexing</span>
          <span>DNS</span>
          <span />
        </div>
        {editing === "new" && (
          <DomainForm
            initial={blank}
            resource={resource}
            existing={hosts}
            defaultPort={settings.defaultPort}
            pending={mutation.isPending}
            onCancel={() => setEditing(null)}
            onSubmit={(draft) => {
              if (current.domains.some((d) => key(d) === key(draft))) {
                toast.error(`${draft.host} is already added.`);
                return;
              }
              mutation.mutate(
                { ...current, domains: [...current.domains, draft] },
                {
                  onSuccess: () => {
                    toast.success(`${draft.host} added`);
                    setEditing(null);
                    void check(draft.host);
                  },
                },
              );
            }}
          />
        )}
        {visible.length === 0 && editing !== "new" && (
          <Empty
            icon="globe"
            hue="accent"
            title={
              settings.domains.length ? "No matching domains" : "No domains yet"
            }
            description="Point a domain’s A record at your server, then add it here. Certificates are issued automatically."
            action={() => setEditing("new")}
            actionLabel="Add domain"
            compact
          />
        )}
        {visible.map((d) => {
          const k = key(d);
          const result = dns[d.host];
          if (editing === k)
            return (
              <DomainForm
                key={k}
                initial={d}
                resource={resource}
                existing={hosts}
                defaultPort={settings.defaultPort}
                pending={mutation.isPending}
                onCancel={() => setEditing(null)}
                onSubmit={(draft) =>
                  mutation.mutate(
                    {
                      ...current,
                      domains: current.domains.map((x) =>
                        key(x) === k ? draft : x,
                      ),
                    },
                    {
                      onSuccess: () => {
                        toast.success(`${draft.host} updated`);
                        setEditing(null);
                      },
                    },
                  )
                }
              />
            );
          return (
            <div className="domain-row" key={k}>
              <span className="domain-main">
                <Tile
                  icon="globe"
                  hue={d.scheme === "https" ? "green" : "amber"}
                  size="sm"
                />
                <span className="row-text">
                  <a
                    className="row-title mono"
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {d.host}
                    {d.path}
                  </a>
                  <span className="row-sub mono">{d.url}</span>
                </span>
              </span>
              <span>
                <span
                  className={`meta-chip ${d.scheme === "https" ? "chip-green" : "chip-amber"}`}
                >
                  <Icon
                    name={d.scheme === "https" ? "lock" : "danger"}
                    size={12}
                  />
                  {d.scheme.toUpperCase()}
                  {d.scheme === "http" && settings.forceHttps && " → S"}
                </span>
              </span>
              <span className="mono">
                {d.port || (
                  <span className="muted">
                    {settings.defaultPort || "auto"}
                  </span>
                )}
              </span>
              <span>
                <Switch
                  checked={d.indexed}
                  label={`${d.indexed ? "Hide" : "Show"} ${d.host} in search engines`}
                  disabled={mutation.isPending}
                  onChange={(indexed) =>
                    save(
                      {
                        domains: current.domains.map((x) =>
                          key(x) === k ? { ...x, indexed } : x,
                        ),
                      },
                      indexed
                        ? `${d.host} can be indexed`
                        : `${d.host} hidden from search engines`,
                    )
                  }
                />
              </span>
              <span>
                {result === "checking" ? (
                  <span className="pill s-deploying">
                    <span className="dot" />
                    Checking
                  </span>
                ) : result ? (
                  <span
                    className={`pill ${dnsCopy[result.status].tone}`}
                    title={`${dnsCopy[result.status].hint}${result.addresses.length ? `\n${result.addresses.join(", ")}` : ""}${result.cname.length ? `\nCNAME ${result.cname.join(", ")}` : ""}`}
                  >
                    <span className="dot" />
                    {dnsCopy[result.status].label}
                  </span>
                ) : (
                  <span className="pill s-unknown">
                    <span className="dot" />
                    Not checked
                  </span>
                )}
              </span>
              <span className="domain-actions">
                <button
                  className="icon-button"
                  title="Check DNS"
                  aria-label={`Check DNS for ${d.host}`}
                  onClick={() => void check(d.host)}
                >
                  <Icon
                    name="refresh"
                    size={16}
                    className={result === "checking" ? "spin" : ""}
                  />
                </button>
                <button
                  className="icon-button"
                  title="Edit"
                  aria-label={`Edit ${d.host}`}
                  onClick={() => setEditing(k)}
                >
                  <Icon name="settings" size={16} />
                </button>
                <button
                  className="icon-button danger-hover"
                  title="Remove"
                  aria-label={`Remove ${d.host}`}
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Remove ${d.host}?`,
                      description:
                        "The app stops answering on this domain after the next deployment.",
                      confirmLabel: "Remove domain",
                      icon: "trash",
                    });
                    if (ok)
                      save(
                        {
                          domains: current.domains.filter((x) => key(x) !== k),
                        },
                        `${d.host} removed`,
                      );
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </div>
          );
        })}
      </section>
      {serverIp && (
        <p className="list-foot">
          <Icon name="server" size={15} />
          Point A records to <code>{serverIp}</code>
          {settings.serverIps.length > 1 &&
            ` (or ${settings.serverIps.slice(1).join(", ")})`}
          . Hosts behind Cloudflare show as proxied.
        </p>
      )}
    </div>
  );
}

function DomainForm({
  initial,
  resource,
  existing,
  defaultPort,
  pending,
  onCancel,
  onSubmit,
}: {
  initial: Draft;
  resource: Resource;
  existing: string[];
  defaultPort: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    host: initial.host,
    scheme: initial.scheme,
    port: initial.port,
    path: initial.path,
    indexed: initial.indexed,
  });
  const valid =
    /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      draft.host,
    );
  return (
    <form
      className="domain-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(draft);
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <label className="field domain-host">
        <span>Domain</span>
        <input
          className="mono"
          autoFocus
          required
          placeholder="app.example.com or paste a full URL"
          value={draft.host}
          onChange={(e) => setDraft(fromInput(e.target.value, draft))}
        />
      </label>
      <div className="field">
        <span>Protocol</span>
        <Segmented
          value={draft.scheme}
          onChange={(scheme) => setDraft({ ...draft, scheme })}
          options={[
            { value: "https", label: "HTTPS" },
            { value: "http", label: "HTTP" },
          ]}
        />
      </div>
      <label className="field domain-port">
        <span>Internal port</span>
        <input
          className="mono"
          inputMode="numeric"
          placeholder={defaultPort || "auto"}
          value={draft.port}
          onChange={(e) =>
            setDraft({
              ...draft,
              port: e.target.value.replace(/\D/g, "").slice(0, 5),
            })
          }
        />
      </label>
      <label className="field domain-path">
        <span>Path</span>
        <input
          className="mono"
          placeholder="/"
          value={draft.path}
          onChange={(e) => setDraft({ ...draft, path: e.target.value })}
        />
      </label>
      <div className="field">
        <span>Indexing</span>
        <Switch
          checked={draft.indexed}
          onChange={(indexed) => setDraft({ ...draft, indexed })}
          label="Allow search indexing"
        />
      </div>
      <div className="domain-form-actions">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!valid || pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <div className="domain-form-suggestions">
        <DomainSuggestions
          name={resource.name}
          resourceId={resource.id}
          environment={resource.environment}
          project={resource.projectName}
          value={draft.host}
          exclude={existing}
          onPick={(host) => setDraft({ ...draft, host })}
        />
      </div>
    </form>
  );
}
