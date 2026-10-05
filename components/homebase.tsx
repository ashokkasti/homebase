"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Icon } from "./ui/icon";
import {
  capitalize,
  Empty,
  Kbd,
  Keys,
  Loading,
  Menu,
  MenuItem,
  MenuSeparator,
  Tile,
  useNow,
} from "./kit";
import { ConfirmProvider } from "./confirm";
import { useAppearance } from "./appearance";
import { Connection } from "./connection";
import { navGroups, navigation, shortcuts } from "./navigation";
import { Palette } from "./palette";
import { useDashboardQuery, WorkspaceProvider } from "./workspace";
import { Overview } from "./pages/overview";
import { ResourceList } from "./pages/resource-list";
import { ResourceDetail } from "./pages/resource-detail";
import { DeploymentList, DeploymentPage } from "./pages/deployments";
import { BackupsPage } from "./pages/backups";
import { ProjectsPage } from "./pages/projects";
import { ServerPage, ServersPage } from "./pages/servers";
import { NewResource } from "./pages/new-resource";
import { SettingsPage, signOut } from "./pages/settings";
import type { Dashboard } from "@/lib/schemas";

const sectionKinds = {
  apps: "app",
  databases: "database",
  services: "service",
} as const;
const sectionLabels: Record<string, string> = {
  overview: "Overview",
  apps: "Applications",
  databases: "Databases",
  services: "Services",
  deployments: "Deployments",
  backups: "Backups",
  projects: "Projects",
  servers: "Servers",
  settings: "Settings",
  new: "New resource",
};

export function Homebase() {
  return (
    <ConfirmProvider>
      <Shell />
    </ConfirmProvider>
  );
}

function Shell() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { resolvedTheme, setTheme } = useTheme();
  const query = useDashboardQuery();
  const data = query.data;
  const now = useNow(5000);
  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const section = parts[0] ?? "overview";
  const { appearance, update: updateAppearance } = useAppearance();
  const toggleSidebar = () =>
    updateAppearance({
      sidebar: appearance.sidebar === "compact" ? "expanded" : "compact",
    });
  const toggleTheme = () =>
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  const handlers = useRef({
    refresh: () => {},
    toggleTheme: () => {},
    toggleSidebar: () => {},
  });
  handlers.current = {
    refresh: () => void query.refetch(),
    toggleTheme,
    toggleSidebar,
  };
  const awaitingG = useRef(0);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      )
        return;
      if (document.querySelector("[role=dialog]")) return;
      const k = event.key.toLowerCase();
      if (Date.now() - awaitingG.current < 1200) {
        awaitingG.current = 0;
        const destination =
          k === "," ? "/settings" : navigation.find((n) => n.key === k)?.href;
        if (destination) {
          event.preventDefault();
          router.push(destination);
        }
        return;
      }
      if (k === "g") awaitingG.current = Date.now();
      else if (k === "/") {
        const input =
          document.querySelector<HTMLInputElement>("[data-page-search]");
        if (input) {
          event.preventDefault();
          input.focus();
        }
      } else if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
      } else if (k === "c") {
        event.preventDefault();
        router.push("/new");
      } else if (k === "r") handlers.current.refresh();
      else if (k === "t") handlers.current.toggleTheme();
      else if (event.key === "\\") {
        event.preventDefault();
        handlers.current.toggleSidebar();
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [router]);
  const primaryServer = data?.servers[0];
  const deploying =
    data?.deployments.filter(
      (d) => d.status === "deploying" || d.status === "queued",
    ).length ?? 0;
  const counts: Record<string, number | undefined> = {
    Apps: data?.resources.filter((r) => r.kind === "app").length,
    Databases: data?.resources.filter((r) => r.kind === "database").length,
    Services: data?.resources.filter((r) => r.kind === "service").length,
    Servers: data?.servers.length,
  };
  const synced = query.dataUpdatedAt
    ? Math.max(0, Math.round((now - query.dataUpdatedAt) / 1000))
    : null;
  const crumbs = breadcrumbs(parts, data);
  return (
    <WorkspaceProvider query={query}>
      <div className="shell">
        <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
          <div className="brand-row">
            <Link
              href="/"
              className="brand"
              onClick={() => setMobileOpen(false)}
            >
              <span className="brand-mark">
                <Icon name="home" size={18} />
              </span>
              homebase
            </Link>
            <span
              className={`env-pill ${data?.demo ? "env-demo" : "env-live"}`}
            >
              {data?.demo ? "Demo" : "Live"}
            </span>
          </div>
          <Link
            className="workspace"
            href={
              primaryServer
                ? `/servers/${encodeURIComponent(primaryServer.id)}`
                : "/servers"
            }
            onClick={() => setMobileOpen(false)}
          >
            <Tile icon="server" hue="server" size="sm" />
            <span className="row-text">
              <span className="row-title">
                {primaryServer?.name ?? "Home Server"}
              </span>
              <span className="row-sub">
                <span
                  className={`live-dot ${primaryServer?.online ? "on" : ""}`}
                />
                {data?.demo
                  ? "Demo workspace"
                  : data?.connected
                    ? primaryServer?.online
                      ? "Online"
                      : "Personal workspace"
                    : "Not connected"}
              </span>
            </span>
            <Icon name="chevronRight" size={14} className="muted" />
          </Link>
          <div className="sidebar-actions">
            <button
              className="search-trigger"
              onClick={() => setCommandOpen(true)}
            >
              <Icon name="search" size={16} />
              <span>Search…</span>
              <Keys keys={["⌘", "K"]} />
            </button>
            <Link
              className="new-trigger"
              href="/new"
              title="New resource (C)"
              aria-label="New resource"
              onClick={() => setMobileOpen(false)}
            >
              <Icon name="plus" size={18} />
            </Link>
          </div>
          <nav className="nav" aria-label="Main navigation">
            {navGroups.map((group) => (
              <div className="nav-group" key={group}>
                <span className="nav-label">{group}</span>
                {navigation
                  .filter((item) => item.group === group)
                  .map((item) => {
                    const active =
                      section ===
                      (item.href === "/" ? "overview" : item.href.slice(1));
                    const count = counts[item.label];
                    return (
                      <Link
                        href={item.href}
                        key={item.href}
                        className={`nav-item hue-${item.hue} ${active ? "active" : ""}`}
                        title={item.label}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setMobileOpen(false)}
                      >
                        <Icon name={item.icon} size={18} />
                        <span>{item.label}</span>
                        {item.label === "Deployments" && deploying > 0 ? (
                          <span className="nav-live">{deploying}</span>
                        ) : count !== undefined ? (
                          <span className="nav-count mono">{count}</span>
                        ) : null}
                        <span className="nav-key">
                          <Kbd>G</Kbd>
                          <Kbd>{item.key.toUpperCase()}</Kbd>
                        </span>
                      </Link>
                    );
                  })}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <Link
              className={`nav-item hue-neutral ${section === "settings" ? "active" : ""}`}
              title="Settings"
              href="/settings"
              onClick={() => setMobileOpen(false)}
            >
              <Icon name="settings" size={18} />
              <span>Settings</span>
              <span className="nav-key">
                <Kbd>G</Kbd>
                <Kbd>,</Kbd>
              </span>
            </Link>
            <div className="account">
              <span className="avatar">
                {(appearance.name || "A").slice(0, 1).toUpperCase()}
              </span>
              <span className="row-text">
                <span className="row-title">
                  {appearance.name || "Administrator"}
                </span>
                <span className="row-sub">
                  {data?.demo ? "Demo access" : "Personal server"}
                </span>
              </span>
              <Menu label="Account" size={17}>
                <MenuItem
                  icon="settings"
                  onSelect={() => router.push("/settings")}
                >
                  Settings
                </MenuItem>
                <MenuItem
                  icon="keyboard"
                  onSelect={() => setShortcutsOpen(true)}
                  hint="?"
                >
                  Shortcuts
                </MenuItem>
                <MenuItem
                  icon={resolvedTheme === "dark" ? "sun" : "moon"}
                  onSelect={toggleTheme}
                  hint="T"
                >
                  {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon="logout" onSelect={() => void signOut()}>
                  Sign out
                </MenuItem>
              </Menu>
            </div>
          </div>
        </aside>
        {mobileOpen && (
          <button
            className="scrim"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
        )}
        <div className="main">
          <header className="topbar">
            <button
              className="icon-button mobile-only"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Icon name="menu" size={20} />
            </button>
            <nav className="crumbs" aria-label="Breadcrumb">
              <Link href="/" className="crumb-root">
                Workspace
              </Link>
              {crumbs.map((crumb, i) => (
                <span className="crumb" key={crumb.href}>
                  <Icon name="chevronRight" size={12} className="crumb-sep" />
                  {i === crumbs.length - 1 ? (
                    <span
                      className={`crumb-current ${crumb.mono ? "mono" : ""}`}
                    >
                      {crumb.label}
                    </span>
                  ) : (
                    <Link href={crumb.href}>{crumb.label}</Link>
                  )}
                </span>
              ))}
            </nav>
            <div className="topbar-right">
              <button
                className={`sync ${query.isFetching ? "syncing" : ""} ${query.isError ? "sync-error" : ""}`}
                onClick={() => void query.refetch()}
                title="Refresh (R)"
              >
                <span className="live-dot on" />
                <span className="mono">
                  {query.isError
                    ? "Offline"
                    : query.isFetching
                      ? "Syncing"
                      : synced === null
                        ? "Connecting"
                        : synced < 5
                          ? "Live"
                          : `${synced}s ago`}
                </span>
                <Icon
                  name="refresh"
                  size={14}
                  className={query.isFetching ? "spin" : ""}
                />
              </button>
              <button
                className="icon-button"
                aria-label="Search"
                onClick={() => setCommandOpen(true)}
              >
                <Icon name="search" size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="Toggle dark mode"
                onClick={toggleTheme}
              >
                <Icon name="sun" size={18} className="show-dark" />
                <Icon name="moon" size={18} className="show-light" />
              </button>
              <button
                className="icon-button desktop-only"
                aria-label="Keyboard shortcuts"
                onClick={() => setShortcutsOpen(true)}
              >
                <Icon name="keyboard" size={18} />
              </button>
            </div>
          </header>
          <main
            className={`page ${section === "deployments" && parts[1] ? "page-wide" : ""}`}
            key={`${parts.slice(0, 2).join("/")}-${appearance.timestamps}-${appearance.clock}`}
          >
            {query.isLoading ? (
              <Loading hero />
            ) : query.isError ? (
              <Empty
                icon="cloud"
                hue="red"
                title="Couldn’t reach your server"
                description={query.error.message}
                action={() => void query.refetch()}
                actionLabel="Try again"
              />
            ) : (
              data && (
                <>
                  {data.warnings.length > 0 && (
                    <div className="banner banner-amber" role="alert">
                      <Icon name="danger" size={18} />
                      <span>
                        {data.warnings.join(" ")} Some information may be
                        unavailable.
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void query.refetch()}
                      >
                        Retry
                      </Button>
                    </div>
                  )}
                  {!data.demo && !data.connected && section !== "settings" ? (
                    <Connection
                      onConnected={() =>
                        void queryClient.invalidateQueries({
                          queryKey: ["dashboard"],
                        })
                      }
                    />
                  ) : (
                    <Page
                      parts={parts}
                      data={data}
                      onCommand={() => setCommandOpen(true)}
                      onShortcuts={() => setShortcutsOpen(true)}
                    />
                  )}
                </>
              )
            )}
            <footer className="page-foot">
              <span>
                <Icon name="home" size={14} />
                homebase
              </span>
              <span className="mono">
                {data?.demo ? "preview workspace" : "powered by coolify"}
              </span>
            </footer>
          </main>
        </div>
        {data && (
          <Palette
            open={commandOpen}
            onOpenChange={setCommandOpen}
            onShortcuts={() => setShortcutsOpen(true)}
            onToggleTheme={toggleTheme}
            onToggleSidebar={toggleSidebar}
          />
        )}
        <Dialog
          open={shortcutsOpen}
          onOpenChange={setShortcutsOpen}
          title="Keyboard shortcuts"
          description="Move through Homebase without leaving the keyboard."
          icon={<Tile icon="keyboard" hue="accent" />}
          wide
        >
          <div className="shortcut-columns">
            {[...new Set(shortcuts.map((s) => s.group))].map((group) => (
              <div key={group} className="shortcut-list">
                <span className="nav-label">{group}</span>
                {shortcuts
                  .filter((s) => s.group === group)
                  .map((s) => (
                    <div className="shortcut" key={s.label}>
                      <span>{s.label}</span>
                      <Keys keys={s.keys} />
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </Dialog>
      </div>
    </WorkspaceProvider>
  );
}

function breadcrumbs(parts: string[], data: Dashboard | undefined) {
  const [section = "overview", id, tab] = parts;
  const crumbs: { label: string; href: string; mono?: boolean }[] = [
    {
      label: sectionLabels[section] ?? capitalize(section),
      href: `/${parts[0] ?? ""}`,
    },
  ];
  if (id) {
    const resource = data?.resources.find((r) => r.id === id);
    const server = data?.servers.find((s) => s.id === id);
    const deployment = data?.deployments.find((d) => d.id === id);
    crumbs.push({
      label:
        resource?.name ??
        server?.name ??
        (deployment
          ? `${deployment.name} · ${id.slice(0, 8)}`
          : section === "deployments"
            ? id.slice(0, 12)
            : capitalize(id)),
      href: `/${section}/${encodeURIComponent(id)}`,
      mono: section === "deployments" && !deployment,
    });
  }
  if (tab)
    crumbs.push({
      label: capitalize(tab),
      href: `/${section}/${encodeURIComponent(id ?? "")}/${tab}`,
    });
  return crumbs;
}

function Page({
  parts,
  data,
  onCommand,
  onShortcuts,
}: {
  parts: string[];
  data: Dashboard;
  onCommand: () => void;
  onShortcuts: () => void;
}) {
  const router = useRouter();
  const [section = "overview", id, tab] = parts;
  if (section === "overview") return <Overview onCommand={onCommand} />;
  if (section in sectionKinds) {
    const kind = sectionKinds[section as keyof typeof sectionKinds];
    if (!id) return <ResourceList kind={kind} />;
    const resource = data.resources.find((r) => r.id === id && r.kind === kind);
    if (resource) return <ResourceDetail resource={resource} tab={tab ?? ""} />;
  }
  if (section === "deployments")
    return id ? <DeploymentPage id={id} /> : <DeploymentList />;
  if (section === "backups") return <BackupsPage />;
  if (section === "projects") return <ProjectsPage />;
  if (section === "servers")
    return id ? <ServerPage id={id} /> : <ServersPage />;
  if (section === "new") return <NewResource parts={parts.slice(1)} />;
  if (section === "settings") return <SettingsPage onShortcuts={onShortcuts} />;
  return (
    <Empty
      icon="search"
      hue="neutral"
      title="Page not found"
      description="This resource may have been removed."
      action={() => router.push("/")}
      actionLabel="Back to overview"
    />
  );
}
