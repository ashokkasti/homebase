"use client";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { serverDetailSchema } from "@/lib/schemas";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import {
  CopyButton,
  Empty,
  Loading,
  PageHead,
  ResourceTile,
  resourcePath,
  SectionHeading,
  Status,
  Tile,
} from "../kit";
import { ServerCard } from "./overview";
import { useConfirm } from "../confirm";
import { useWorkspace } from "../workspace";

export function ServersPage() {
  const { data } = useWorkspace();
  return (
    <>
      <PageHead
        icon="server"
        hue="server"
        title="Servers"
        count={data.servers.length}
        description="The machines Coolify deploys to."
      />
      {data.servers.length === 0 ? (
        <Empty
          icon="server"
          hue="server"
          title="No servers"
          description="Add a server in Coolify, then it appears here."
        />
      ) : (
        <div className="server-grid">
          {data.servers.map((server) => (
            <section className="panel" key={server.id}>
              <ServerCard server={server} />
            </section>
          ))}
        </div>
      )}
    </>
  );
}

const actionResult = z.object({
  ok: z.boolean(),
  demo: z.boolean().optional(),
});

export function ServerPage({ id }: { id: string }) {
  const { data } = useWorkspace();
  const confirm = useConfirm();
  const summary = data.servers.find((s) => s.id === id);
  const query = useQuery({
    queryKey: ["server", id],
    queryFn: () => api(`servers/${encodeURIComponent(id)}`, serverDetailSchema),
    refetchInterval: 30000,
  });
  const action = useMutation({
    mutationFn: (name: "validate" | "restart-proxy" | "docker-cleanup") =>
      api(`servers/${encodeURIComponent(id)}/action`, actionResult, {
        action: name,
      }),
    onSuccess: (_r, name) =>
      toast.success(
        name === "validate"
          ? "Validation started"
          : name === "restart-proxy"
            ? "Proxy restart queued"
            : "Docker cleanup started",
      ),
    onError: (error) => toast.error(error.message),
  });
  if (query.isLoading) return <Loading rows={6} />;
  if (query.isError || !query.data)
    return (
      <Empty
        icon="server"
        hue="red"
        title="Server unavailable"
        description={query.error?.message ?? ""}
        action={() => void query.refetch()}
        actionLabel="Try again"
      />
    );
  const server = query.data;
  return (
    <>
      <Link className="back-link" href="/servers">
        <Icon name="arrowLeft" size={15} />
        Servers
      </Link>
      <div className="detail-head hue-server">
        <Tile icon="server" hue="server" size="xl" />
        <div className="detail-title">
          <span className="eyebrow">Server</span>
          <h1>{server.name}</h1>
          <div className="detail-meta">
            <span
              className={`pill ${server.online === null ? "s-unknown" : server.online ? "s-running" : "s-failed"}`}
            >
              <span className="dot" />
              {server.online === null
                ? "Unknown"
                : server.online
                  ? "Reachable"
                  : "Unreachable"}
            </span>
            <span className="meta-chip mono">
              {server.user}@{server.ip}:{server.port}
              <CopyButton
                value={`ssh ${server.user}@${server.ip} -p ${server.port}`}
                label="Copy SSH command"
              />
            </span>
            <span className="meta-chip">
              <Icon name="proxy" size={13} />
              {server.proxy}
            </span>
          </div>
        </div>
        <div className="head-actions">
          <Button
            variant="outline"
            disabled={action.isPending}
            onClick={() => action.mutate("validate")}
          >
            <Icon name="shield" size={16} />
            Validate
          </Button>
          <Button
            variant="outline"
            disabled={action.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: "Restart the proxy?",
                description:
                  "Every app on this server is briefly unreachable while the proxy restarts.",
                confirmLabel: "Restart proxy",
                icon: "proxy",
                tone: "default",
              });
              if (ok) action.mutate("restart-proxy");
            }}
          >
            <Icon name="proxy" size={16} />
            Restart proxy
          </Button>
          <Button
            disabled={action.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: "Run Docker cleanup?",
                description:
                  "Removes unused images, build cache and stopped containers to free disk space.",
                confirmLabel: "Clean up",
                icon: "broom",
                tone: "default",
              });
              if (ok) action.mutate("docker-cleanup");
            }}
          >
            <Icon name="broom" size={16} />
            Clean up
          </Button>
        </div>
      </div>
      <div className="detail-grid">
        <div className="stack">
          {summary && (
            <section className="panel">
              <ServerCard server={summary} />
            </section>
          )}
          <section className="panel">
            <SectionHeading title="Resources" count={server.resources.length} />
            <div className="rows rows-compact">
              {server.resources.length === 0 && (
                <p className="muted small pad">Nothing deployed here yet.</p>
              )}
              {server.resources.map((r) => {
                const known = data.resources.find((x) => x.id === r.id);
                const content = (
                  <>
                    {known ? (
                      <ResourceTile resource={known} size="sm" />
                    ) : (
                      <Tile icon="box" hue="neutral" size="sm" />
                    )}
                    <span className="row-text">
                      <span className="row-title">{r.name}</span>
                      <span className="row-sub">{r.type}</span>
                    </span>
                  </>
                );
                return (
                  <div className="row" key={r.id}>
                    {known ? (
                      <Link className="row-main" href={resourcePath(known)}>
                        {content}
                      </Link>
                    ) : (
                      <span className="row-main">{content}</span>
                    )}
                    <Status status={r.status} />
                  </div>
                );
              })}
            </div>
          </section>
          <section className="panel">
            <SectionHeading title="Domains" />
            <div className="domain-list">
              {server.domains.flatMap((group) => group.domains).length ===
                0 && (
                <p className="muted small pad">
                  No domains routed through this server.
                </p>
              )}
              {server.domains.flatMap((group) =>
                group.domains.map((domain) => (
                  <div className="domain-row" key={`${group.ip}-${domain}`}>
                    <Icon name="globe" size={15} />
                    <a
                      className="mono"
                      href={`https://${domain}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {domain}
                    </a>
                    <span className="mono muted">{group.ip}</span>
                  </div>
                )),
              )}
            </div>
          </section>
        </div>
        <aside className="info-card">
          <h3>Settings</h3>
          {server.description && (
            <p className="muted small">{server.description}</p>
          )}
          {Object.entries(server.settings).map(([label, value]) => (
            <div className="info-row" key={label}>
              <span>{label}</span>
              <span className="info-value mono">
                <span className="truncate">{value}</span>
              </span>
            </div>
          ))}
        </aside>
      </div>
    </>
  );
}
