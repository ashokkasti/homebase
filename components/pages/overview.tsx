"use client";
import Link from "next/link";
import type { Dashboard } from "@/lib/schemas";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import {
  countStatuses,
  Empty,
  Gauge,
  Keys,
  ResourceTile,
  resourcePath,
  SectionHeading,
  StatusBar,
  Tile,
  timeAgo,
  useNow,
  type Hue,
} from "../kit";
import { DeploymentRows, ResourceRows } from "../rows";
import { useWorkspace } from "../workspace";
import { useAppearance } from "../appearance";
import type { OverviewSection } from "@/lib/appearance";

export function ServerCard({
  server,
}: {
  server: Dashboard["servers"][number];
}) {
  return (
    <div className="server-card">
      <Link
        className="server-head"
        href={`/servers/${encodeURIComponent(server.id)}`}
      >
        <Tile icon="server" hue="server" />
        <span className="row-text">
          <span className="row-title">{server.name}</span>
          <span className="row-sub mono">{server.ip || "IP unavailable"}</span>
        </span>
        <span
          className={`pill ${server.online === null ? "s-unknown" : server.online ? "s-running" : "s-failed"}`}
        >
          <span className="dot" />
          {server.online === null
            ? "Unknown"
            : server.online
              ? "Online"
              : "Offline"}
        </span>
      </Link>
      <div className="gauges">
        <Gauge
          label="CPU"
          icon="cpu"
          value={server.cpu === null ? "—" : "utilization"}
          percent={server.cpu}
        />
        <Gauge
          label="Memory"
          icon="memory"
          value={
            server.memory === null
              ? "—"
              : `${server.memory}/${server.memoryTotal} GB`
          }
          percent={
            server.memory !== null && server.memoryTotal
              ? (server.memory / server.memoryTotal) * 100
              : null
          }
        />
        <Gauge
          label="Storage"
          icon="disk"
          value={
            server.storage === null
              ? "—"
              : `${server.storage}/${server.storageTotal} GB`
          }
          percent={
            server.storage !== null && server.storageTotal
              ? (server.storage / server.storageTotal) * 100
              : null
          }
        />
      </div>
      <div className="server-foot">
        <span className="muted">{server.os || "Managed by Coolify"}</span>
        <Link
          className="text-link"
          href={`/servers/${encodeURIComponent(server.id)}`}
        >
          Details
          <Icon name="arrowRight" size={14} />
        </Link>
      </div>
    </div>
  );
}

export function Overview({ onCommand }: { onCommand: () => void }) {
  const { data, openCoolify } = useWorkspace();
  const { appearance } = useAppearance();
  const show = (id: OverviewSection) => !appearance.hidden.includes(id);
  const now = useNow(60000);
  const apps = data.resources.filter((r) => r.kind === "app");
  const databases = data.resources.filter((r) => r.kind === "database");
  const services = data.resources.filter((r) => r.kind === "service");
  const totals = countStatuses(data.resources);
  const allOkay =
    data.connected &&
    !data.warnings.length &&
    !totals.failed &&
    !totals.stopped &&
    data.servers.length > 0 &&
    data.servers.every((s) => s.online === true);
  const health: Hue = totals.failed
    ? "red"
    : data.warnings.length > 0 || data.servers.some((s) => s.online === false)
      ? "amber"
      : "green";
  const recent = data.deployments.slice(0, 24).reverse();
  const finished = data.deployments.filter(
    (d) => d.status === "successful" || d.status === "failed",
  );
  const successRate = finished.length
    ? Math.round(
        (finished.filter((d) => d.status === "successful").length /
          finished.length) *
          100,
      )
    : null;
  const hour = new Date(now).getHours();
  const primaryServer = data.servers[0];
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow mono">
            {new Date(now).toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </span>
          <h1>
            {hour < 12
              ? "Good morning"
              : hour < 17
                ? "Good afternoon"
                : "Good evening"}
            {appearance.name ? `, ${appearance.name}` : ""}
          </h1>
        </div>
        <div className="head-actions">
          <Button variant="outline" onClick={onCommand}>
            <Icon name="command" size={16} />
            Actions
            <Keys keys={["⌘", "K"]} />
          </Button>
          <Link className="button button-default" href="/new">
            <Icon name="plus" size={16} />
            New
            <Keys keys={["C"]} />
          </Link>
        </div>
      </div>
      {show("hero") && (
        <section className={`hero hue-${health}`}>
          <div className="hero-main">
            <span className="hero-mark">
              <Icon name={health === "green" ? "shield" : "danger"} size={26} />
            </span>
            <div>
              <h2>
                {data.demo
                  ? "Your demo server is looking good"
                  : allOkay
                    ? "All systems operational"
                    : totals.failed
                      ? "A few things need your attention"
                      : totals.stopped
                        ? "Some resources are stopped"
                        : data.warnings.length
                          ? "Some server information is unavailable"
                          : "Your resources are here"}
              </h2>
              <p>
                {data.demo
                  ? "Sample resources are healthy, with one application paused."
                  : allOkay
                    ? "Every resource is healthy. Make yourself at home."
                    : `${totals.running} running${totals.stopped ? ` · ${totals.stopped} stopped` : ""}${totals.failed ? ` · ${totals.failed} need attention` : ""}`}
              </p>
            </div>
          </div>
          <div className="hero-stats">
            {(
              [
                ["running", "Running"],
                ["deploying", "Deploying"],
                ["stopped", "Stopped"],
                ["failed", "Failed"],
              ] as const
            ).map(([key, label]) => (
              <div className={`hero-stat s-${key}`} key={key}>
                <strong className="mono">{totals[key]}</strong>
                <span>
                  <span className="dot" />
                  {label}
                </span>
              </div>
            ))}
          </div>
          <div className="hero-activity">
            <div className="activity-head">
              <span>Recent deploys</span>
              <span className="mono">
                {successRate === null
                  ? "No history"
                  : `${successRate}% success`}
              </span>
            </div>
            <div className="activity-bars">
              {Array.from({ length: 24 }, (_, i) => {
                const d = recent[i - (24 - recent.length)];
                return d ? (
                  <Link
                    key={i}
                    href={`/deployments/${encodeURIComponent(d.id)}`}
                    className={`bar d-${d.status}`}
                    title={`${d.name} · ${d.status} · ${timeAgo(d.date)}`}
                    aria-label={`${d.name} deployment, ${d.status}`}
                  />
                ) : (
                  <span key={i} className="bar bar-empty" />
                );
              })}
            </div>
          </div>
        </section>
      )}
      {show("kpis") && (
        <div className="kpis">
          {[
            {
              label: "Applications",
              list: apps,
              icon: "apps" as const,
              hue: "app" as const,
              href: "/apps",
            },
            {
              label: "Databases",
              list: databases,
              icon: "database" as const,
              hue: "database" as const,
              href: "/databases",
            },
            {
              label: "Services",
              list: services,
              icon: "service" as const,
              hue: "service" as const,
              href: "/services",
            },
          ].map((item) => {
            const counts = countStatuses(item.list);
            return (
              <Link
                className={`kpi hue-${item.hue}`}
                key={item.label}
                href={item.href}
              >
                <span className="kpi-head">
                  <Tile icon={item.icon} hue={item.hue} size="sm" />
                  {item.label}
                  <Icon name="arrowUpRight" size={14} className="kpi-arrow" />
                </span>
                <strong className="kpi-value mono">{item.list.length}</strong>
                <StatusBar counts={counts} total={item.list.length} />
                <span className="kpi-caption">
                  {counts.running} running
                  {counts.stopped ? ` · ${counts.stopped} stopped` : ""}
                  {counts.failed ? ` · ${counts.failed} failed` : ""}
                </span>
              </Link>
            );
          })}
          <Link className="kpi hue-server" href="/servers">
            <span className="kpi-head">
              <Tile icon="server" hue="server" size="sm" />
              Servers
              <Icon name="arrowUpRight" size={14} className="kpi-arrow" />
            </span>
            <strong className="kpi-value mono">{data.servers.length}</strong>
            <StatusBar
              counts={{
                running: data.servers.filter((s) => s.online).length,
                deploying: 0,
                stopped: 0,
                failed: data.servers.filter((s) => s.online === false).length,
                unknown: data.servers.filter((s) => s.online === null).length,
              }}
              total={data.servers.length}
            />
            <span className="kpi-caption">
              {data.servers.every((s) => s.online)
                ? "All online"
                : "Check status"}
            </span>
          </Link>
        </div>
      )}
      <div
        className={`split ${!show("apps") && !show("deployments") ? "split-side-only" : ""} ${!show("server") && !show("services") && !show("promo") ? "split-main-only" : ""}`}
      >
        <div className="stack">
          {show("apps") && (
            <section className="panel">
              <SectionHeading
                title="Applications"
                count={apps.length}
                href="/apps"
              />
              <ResourceRows resources={apps.slice(0, 5)} compact />
            </section>
          )}
          {show("deployments") && (
            <section className="panel">
              <SectionHeading title="Recent deployments" href="/deployments" />
              <DeploymentRows
                deployments={data.deployments.slice(0, 4)}
                compact
              />
            </section>
          )}
        </div>
        <div className="stack">
          {show("server") && (
            <section className="panel">
              <SectionHeading title="Server" />
              {primaryServer ? (
                <ServerCard server={primaryServer} />
              ) : (
                <Empty
                  icon="server"
                  hue="server"
                  title="No server data"
                  description="Check your Coolify API permissions."
                  compact
                />
              )}
            </section>
          )}
          {show("services") && (
            <section className="panel">
              <SectionHeading
                title="Services"
                count={services.length}
                href="/services"
              />
              <div className="mini-list">
                {services.map((r) => (
                  <Link key={r.id} className="mini-row" href={resourcePath(r)}>
                    <ResourceTile resource={r} size="sm" />
                    <span className="truncate">{r.name}</span>
                    <span className="mono muted">
                      {r.components.length || ""}
                    </span>
                    <span
                      className={`status-dot s-${r.status}`}
                      title={r.status}
                    />
                  </Link>
                ))}
                {services.length === 0 && (
                  <p className="muted small">No services yet.</p>
                )}
              </div>
            </section>
          )}
          {show("promo") && (
            <button className="promo" onClick={() => openCoolify()}>
              <Tile icon="stars" hue="accent" />
              <span className="row-text">
                <span className="row-title">Need more control?</span>
                <span className="row-sub">
                  Advanced settings live in Coolify.
                </span>
              </span>
              <Icon name="arrowUpRight" size={16} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
