"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Resource } from "@/lib/schemas";
import { Button } from "../ui/button";
import { Icon, type IconName } from "../ui/icon";
import {
  domainLabel,
  kindHue,
  kindLabel,
  kindSection,
  Menu,
  MenuItem,
  ResourceTile,
  resourcePath,
  SectionHeading,
  Segmented,
  Status,
  Tile,
  timeAgo,
} from "../kit";
import { DeploymentRows, ResourceMenuItems } from "../rows";
import { RuntimeLogs } from "../log-console";
import { useWorkspace } from "../workspace";
import { EnvironmentTab } from "../resource/environment-tab";
import { ConfigurationTab } from "../resource/configuration-tab";
import { StorageTab } from "../resource/storage-tab";
import { TasksTab } from "../resource/tasks-tab";
import { DeploymentsTab } from "../resource/deployments-tab";
import { DomainsTab } from "../resource/domains-tab";
import { ResourceCrumbs } from "../resource/crumbs";

type Tab = { id: string; label: string; icon: IconName };
function tabsFor(kind: Resource["kind"]): Tab[] {
  return [
    { id: "", label: "Overview", icon: "overview" },
    { id: "logs", label: "Logs", icon: "logs" },
    ...(kind === "app"
      ? [{ id: "deployments", label: "Deployments", icon: "deploy" as const }]
      : []),
    ...(kind === "app"
      ? [{ id: "domains", label: "Domains", icon: "globe" as const }]
      : []),
    { id: "environment", label: "Environment", icon: "key" },
    { id: "configuration", label: "Configuration", icon: "tuning" },
    { id: "storage", label: "Storage", icon: "volume" },
    ...(kind !== "database"
      ? [{ id: "tasks", label: "Tasks", icon: "task" as const }]
      : []),
  ];
}

export function ResourceDetail({
  resource,
  tab,
}: {
  resource: Resource;
  tab: string;
}) {
  const router = useRouter();
  const { run, busy } = useWorkspace();
  const tabs = tabsFor(resource.kind);
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      )
        return;
      if (document.querySelector("[role=dialog]")) return;
      const index = Number(event.key) - 1;
      const next = tabs[index];
      if (next && Number.isInteger(index)) {
        event.preventDefault();
        router.push(resourcePath(resource, next.id || undefined));
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [router, resource, tabs]);
  const deployable = resource.kind !== "database";
  return (
    <>
      <Link className="back-link" href={`/${kindSection(resource.kind)}`}>
        <Icon name="arrowLeft" size={15} />
        {kindLabel(resource.kind)}s
      </Link>
      <div className={`detail-head hue-${kindHue(resource.kind)}`}>
        <ResourceTile resource={resource} size="xl" />
        <div className="detail-title">
          <ResourceCrumbs resource={resource} />
          <h1>{resource.name}</h1>
          <div className="detail-meta">
            <Status status={resource.status} />
            {resource.branch && (
              <span className="meta-chip mono">
                <Icon name="branch" size={13} />
                {resource.branch}
              </span>
            )}
            {resource.domain && (
              <a
                className="meta-chip mono link-chip"
                href={resource.domain}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="globe" size={13} />
                {domainLabel(resource.domain)}
                <Icon name="arrowUpRight" size={12} />
              </a>
            )}
          </div>
        </div>
        <div className="head-actions">
          {resource.status === "stopped" ? (
            <Button
              variant="outline"
              onClick={() => void run(resource, "start")}
            >
              <Icon name="play" size={16} />
              Start
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => void run(resource, "restart")}
            >
              <Icon name="restart" size={16} />
              Restart
            </Button>
          )}
          {deployable && (
            <div className="split-button">
              <Button
                disabled={busy || resource.status === "deploying"}
                onClick={() => void run(resource, "deploy")}
              >
                <Icon
                  name={resource.status === "deploying" ? "refresh" : "deploy"}
                  size={16}
                  className={resource.status === "deploying" ? "spin" : ""}
                />
                {resource.status === "deploying" ? "Deploying…" : "Deploy"}
              </Button>
              <Menu
                label="More deploy options"
                trigger={
                  <button
                    className="button button-default split-caret"
                    aria-label="More deploy options"
                  >
                    <Icon name="chevronDown" size={14} />
                  </button>
                }
              >
                <MenuItem
                  icon="deploy"
                  onSelect={() => void run(resource, "deploy")}
                >
                  Deploy
                </MenuItem>
                {resource.kind === "app" && (
                  <MenuItem
                    icon="bolt"
                    onSelect={() => void run(resource, "force-deploy")}
                  >
                    Force rebuild (no cache)
                  </MenuItem>
                )}
                {resource.kind === "app" && (
                  <MenuItem
                    icon="rollback"
                    onSelect={() =>
                      router.push(resourcePath(resource, "deployments"))
                    }
                  >
                    Roll back…
                  </MenuItem>
                )}
              </Menu>
            </div>
          )}
          <Menu label={`Actions for ${resource.name}`}>
            <ResourceMenuItems resource={resource} />
          </Menu>
        </div>
      </div>
      <nav className="tabs" aria-label="Resource sections">
        {tabs.map((t, i) => (
          <Link
            key={t.id}
            href={resourcePath(resource, t.id || undefined)}
            className={`tab ${t.id === active.id ? "active" : ""}`}
            aria-current={t.id === active.id ? "page" : undefined}
          >
            <Icon name={t.icon} size={16} />
            {t.label}
            <span className="tab-key mono">{i + 1}</span>
          </Link>
        ))}
      </nav>
      <div className="tab-body" key={active.id}>
        {active.id === "" && <OverviewTab resource={resource} />}
        {active.id === "logs" && <LogsTab resource={resource} />}
        {active.id === "deployments" && <DeploymentsTab resource={resource} />}
        {active.id === "domains" && <DomainsTab resource={resource} />}
        {active.id === "environment" && <EnvironmentTab resource={resource} />}
        {active.id === "configuration" && (
          <ConfigurationTab resource={resource} />
        )}
        {active.id === "storage" && <StorageTab resource={resource} />}
        {active.id === "tasks" && <TasksTab resource={resource} />}
      </div>
    </>
  );
}

function OverviewTab({ resource }: { resource: Resource }) {
  const { data, runComponent, openCoolify } = useWorkspace();
  const deployments = data.deployments.filter(
    (d) => d.resourceId === resource.id,
  );
  const last = deployments[0];
  const properties: {
    label: string;
    value: ReactNode;
    icon: IconName;
    mono?: boolean;
  }[] = [
    {
      label: "Last deployed",
      icon: "clock",
      value: last ? timeAgo(last.date) : "No deployment recorded",
    },
    ...(resource.kind === "app" && last
      ? [
          {
            label: "Last change",
            icon: "commit" as const,
            mono: true,
            value: `${last.commit || "—"}${last.message ? ` · ${last.message}` : ""}`,
          },
        ]
      : []),
    ...(resource.kind === "database"
      ? [
          {
            label: "Engine",
            icon: "database" as const,
            value:
              resource.engine || resource.description || "Managed database",
          },
        ]
      : []),
    { label: "Project", icon: "project", value: resource.projectName || "—" },
    { label: "Environment", icon: "apps", value: resource.environment || "—" },
    ...(resource.description
      ? [
          {
            label: "Description",
            icon: "document" as const,
            value: resource.description,
          },
        ]
      : []),
  ];
  const shortcuts: {
    tab: string;
    icon: IconName;
    title: string;
    text: string;
  }[] = [
    {
      tab: "logs",
      icon: "logs",
      title: "Logs",
      text: "Live tail with search and filters",
    },
    {
      tab: "environment",
      icon: "key",
      title: "Environment",
      text: "Variables and secrets",
    },
    {
      tab: "configuration",
      icon: "tuning",
      title: "Configuration",
      text: "Build, network, health checks",
    },
  ];
  return (
    <div className="detail-grid">
      <div className="stack">
        <section className="props">
          {properties.map((p) => (
            <div className="prop" key={p.label}>
              <span className="prop-label">
                <Icon name={p.icon} size={14} />
                {p.label}
              </span>
              <span className={`prop-value ${p.mono ? "mono" : ""}`}>
                {p.value}
              </span>
            </div>
          ))}
        </section>
        <div className="shortcut-cards">
          {shortcuts.map((s) => (
            <Link
              key={s.tab}
              className="shortcut-card"
              href={resourcePath(resource, s.tab)}
            >
              <Tile icon={s.icon} hue={kindHue(resource.kind)} size="sm" />
              <span className="row-text">
                <span className="row-title">{s.title}</span>
                <span className="row-sub">{s.text}</span>
              </span>
              <Icon name="arrowRight" size={14} />
            </Link>
          ))}
        </div>
        {resource.components.length > 0 && (
          <section className="panel">
            <SectionHeading
              title="Components"
              count={resource.components.length}
            />
            <div className="rows rows-compact">
              {resource.components.map((c) => (
                <div className="row" key={c.id ?? c.name}>
                  <span className="row-main">
                    <Tile
                      icon={c.kind === "database" ? "database" : "apps"}
                      hue={c.kind === "database" ? "database" : "app"}
                      size="sm"
                    />
                    <span className="row-title">{c.name}</span>
                  </span>
                  {c.domain && (
                    <a
                      className="meta-chip mono link-chip"
                      href={c.domain}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {domainLabel(c.domain)}
                      <Icon name="arrowUpRight" size={12} />
                    </a>
                  )}
                  <Status status={c.status} />
                  {c.id && c.kind && (
                    <Menu label={`Actions for ${c.name}`} size={17}>
                      {c.status === "stopped" ? (
                        <MenuItem
                          icon="play"
                          onSelect={() =>
                            void runComponent(resource, c, "start")
                          }
                        >
                          Start
                        </MenuItem>
                      ) : (
                        <>
                          <MenuItem
                            icon="restart"
                            onSelect={() =>
                              void runComponent(resource, c, "restart")
                            }
                          >
                            Restart
                          </MenuItem>
                          <MenuItem
                            icon="stop"
                            onSelect={() =>
                              void runComponent(resource, c, "stop")
                            }
                          >
                            Stop
                          </MenuItem>
                        </>
                      )}
                    </Menu>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        {resource.kind === "app" && (
          <section className="panel">
            <SectionHeading
              title="Recent deployments"
              action={
                <Link
                  className="text-link"
                  href={resourcePath(resource, "deployments")}
                >
                  All deployments
                  <Icon name="arrowRight" size={14} />
                </Link>
              }
            />
            <DeploymentRows deployments={deployments.slice(0, 4)} compact />
          </section>
        )}
      </div>
      <aside className="aside-card">
        <Tile icon="shield" hue="accent" size="lg" />
        <h3>Also in Coolify</h3>
        <p>
          Previews, webhooks and advanced proxy rules stay in the Coolify
          dashboard.
        </p>
        <Button
          variant="outline"
          onClick={() => openCoolify(resource.coolifyUrl)}
        >
          Open in Coolify
          <Icon name="arrowUpRight" size={15} />
        </Button>
      </aside>
    </div>
  );
}

function LogsTab({ resource }: { resource: Resource }) {
  const components = resource.components.filter((c) => c.id && c.kind);
  const [componentId, setComponentId] = useState(components[0]?.id ?? "");
  if (resource.kind === "service") {
    const component =
      components.find((c) => c.id === componentId) ?? components[0];
    if (!component)
      return <p className="muted">This service has no components with logs.</p>;
    return (
      <div className="stack">
        {components.length > 1 && (
          <Segmented
            value={component.id ?? ""}
            onChange={setComponentId}
            label="Component"
            options={components.map((c) => ({
              value: c.id ?? "",
              label: c.name,
              dot: c.status,
            }))}
          />
        )}
        <RuntimeLogs
          key={component.id}
          target={{
            id: component.id ?? "",
            type:
              component.kind === "database"
                ? "service-database"
                : "service-application",
            serviceId: resource.id,
            name: `${resource.name}-${component.name}`,
          }}
        />
      </div>
    );
  }
  return (
    <RuntimeLogs
      target={{
        id: resource.id,
        type: resource.kind === "app" ? "app" : "database",
        name: resource.name,
      }}
    />
  );
}
