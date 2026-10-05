"use client";
// Shared building blocks: formatting helpers, tiles, pills, menus, empty states.
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { toast } from "sonner";
import type { Deployment, Resource } from "@/lib/schemas";
import { Button } from "./ui/button";
import { Icon, type IconName } from "./ui/icon";

export type Hue =
  | "accent"
  | "app"
  | "database"
  | "service"
  | "deploy"
  | "backup"
  | "server"
  | "project"
  | "neutral"
  | "green"
  | "amber"
  | "red";
export type StatusKey = Resource["status"];
export const statusOrder: StatusKey[] = [
  "running",
  "deploying",
  "stopped",
  "failed",
  "unknown",
];

// Appearance preferences are read from <html> so plain helpers can honor them.
function pref(key: "timestamps" | "clock") {
  return typeof document === "undefined"
    ? undefined
    : document.documentElement.dataset[key];
}
export function hour12() {
  return pref("clock") === "12h";
}
export function timeAgo(date: string) {
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp)) return "Unknown time";
  if (pref("timestamps") === "absolute") return formatDate(date);
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 2880) return "Yesterday";
  return `${Math.floor(minutes / 1440)}d ago`;
}
export function formatDate(date: string) {
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: hour12(),
  });
}
export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
export function domainLabel(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}
export function formatBytes(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0)
    return "Size unavailable";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
export function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}
export function countStatuses(resources: { status: StatusKey }[]) {
  const counts: Record<StatusKey, number> = {
    running: 0,
    deploying: 0,
    stopped: 0,
    failed: 0,
    unknown: 0,
  };
  for (const r of resources) counts[r.status] += 1;
  return counts;
}
export function kindHue(kind: Resource["kind"]): Hue {
  return kind === "app" ? "app" : kind === "database" ? "database" : "service";
}
export function kindLabel(kind: Resource["kind"]) {
  return kind === "app"
    ? "Application"
    : kind === "database"
      ? "Database"
      : "Service";
}
export function kindSection(kind: Resource["kind"]) {
  return kind === "app"
    ? "apps"
    : kind === "database"
      ? "databases"
      : "services";
}
export function resourcePath(
  resource: Pick<Resource, "kind" | "id">,
  tab?: string,
) {
  return `/${kindSection(resource.kind)}/${encodeURIComponent(resource.id)}${tab ? `/${tab}` : ""}`;
}
export function resourceIcon(
  resource: Pick<Resource, "kind" | "id" | "name">,
): IconName {
  if (resource.kind === "database") return "database";
  if (resource.id === "immich" || resource.name.toLowerCase().includes("photo"))
    return "gallery";
  if (resource.id.startsWith("n8n")) return "workflow";
  if (resource.id === "tunnel") return "cloud";
  if (resource.id === "paperless") return "document";
  if (resource.id === "trekking") return "book";
  if (resource.id === "planner") return "code";
  return resource.kind === "service" ? "service" : "globe";
}
export function useNow(interval: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(timer);
  }, [interval]);
  return now;
}
export async function copyText(value: string, label = "Copied") {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(label);
  } catch {
    toast.error("Could not copy to the clipboard.");
  }
}

export function Tile({
  icon,
  hue,
  size = "md",
  className = "",
}: {
  icon: IconName;
  hue: Hue;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const px = { sm: 14, md: 17, lg: 21, xl: 26 }[size];
  return (
    <span className={`tile tile-${size} hue-${hue} ${className}`}>
      <Icon name={icon} size={px} />
    </span>
  );
}
export function ResourceTile({
  resource,
  size = "md",
}: {
  resource: Pick<Resource, "kind" | "id" | "name">;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  return (
    <Tile
      icon={resourceIcon(resource)}
      hue={kindHue(resource.kind)}
      size={size}
    />
  );
}
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
export function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="kbd-group">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  );
}
export function Status({ status }: { status: StatusKey }) {
  return (
    <span className={`pill s-${status}`}>
      <span className="dot" />
      {capitalize(status)}
    </span>
  );
}
const deploymentStatusMap = {
  successful: { label: "Successful", key: "running" },
  failed: { label: "Failed", key: "failed" },
  queued: { label: "Queued", key: "unknown" },
  deploying: { label: "Deploying", key: "deploying" },
} as const;
export function DeploymentStatus({ status }: { status: Deployment["status"] }) {
  return (
    <span className={`pill s-${deploymentStatusMap[status].key}`}>
      <span className="dot" />
      {deploymentStatusMap[status].label}
    </span>
  );
}
export function StatusBar({
  counts,
  total,
}: {
  counts: Record<StatusKey, number>;
  total: number;
}) {
  return (
    <span className="status-bar" aria-hidden>
      {total === 0 ? (
        <span className="seg s-empty" style={{ flexGrow: 1 }} />
      ) : (
        statusOrder.map((s) =>
          counts[s] ? (
            <span
              key={s}
              className={`seg s-${s}`}
              style={{ flexGrow: counts[s] }}
            />
          ) : null,
        )
      )}
    </span>
  );
}
export function Gauge({
  label,
  value,
  percent,
  icon,
}: {
  label: string;
  value: string;
  percent: number | null;
  icon: IconName;
}) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const pct = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  const level =
    percent === null
      ? "none"
      : pct >= 90
        ? "red"
        : pct >= 70
          ? "amber"
          : "green";
  return (
    <div className={`gauge gauge-${level}`}>
      <svg viewBox="0 0 64 64" aria-hidden>
        <circle className="gauge-track" cx="32" cy="32" r={radius} />
        <circle
          className="gauge-value"
          cx="32"
          cy="32"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct / 100)}
        />
      </svg>
      <span className="gauge-center">
        {percent === null ? (
          <Icon name={icon} size={18} />
        ) : (
          <strong>
            {Math.round(pct)}
            <small>%</small>
          </strong>
        )}
      </span>
      <span className="gauge-label">{label}</span>
      <span className="gauge-text">{value}</span>
    </div>
  );
}
export function MenuItem({
  icon,
  children,
  onSelect,
  danger = false,
  disabled = false,
  hint,
}: {
  icon: IconName;
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <Dropdown.Item
      className={`menu-item ${danger ? "danger" : ""}`}
      disabled={disabled}
      onSelect={onSelect}
    >
      <Icon name={icon} size={16} />
      <span>{children}</span>
      {hint && <Kbd>{hint}</Kbd>}
    </Dropdown.Item>
  );
}
export function MenuSeparator() {
  return <Dropdown.Separator className="menu-separator" />;
}
export function MenuLabel({ children }: { children: ReactNode }) {
  return <Dropdown.Label className="menu-label">{children}</Dropdown.Label>;
}
export function Menu({
  label,
  children,
  size = 18,
  trigger,
}: {
  label: string;
  children: ReactNode;
  size?: number;
  trigger?: ReactNode;
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        asChild={!!trigger}
        className={trigger ? undefined : "icon-button"}
        aria-label={label}
      >
        {trigger ?? <Icon name="more" size={size} />}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className="menu" align="end" sideOffset={6}>
          {children}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
export function SectionHeading({
  title,
  count,
  href,
  action,
}: {
  title: ReactNode;
  count?: number;
  href?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <h2>
        {title}
        {count !== undefined && <span className="count">{count}</span>}
      </h2>
      {href && (
        <Link className="text-link" href={href}>
          View all
          <Icon name="arrowRight" size={14} />
        </Link>
      )}
      {action}
    </div>
  );
}
export function PageHead({
  icon,
  hue,
  title,
  count,
  description,
  children,
}: {
  icon: IconName;
  hue: Hue;
  title: string;
  count?: number;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="page-title">
        <Tile icon={icon} hue={hue} size="lg" />
        <div>
          <h1>
            {title}
            {count !== undefined && (
              <span className="h1-count mono">{count}</span>
            )}
          </h1>
          <p>{description}</p>
        </div>
      </div>
      {children && <div className="head-actions">{children}</div>}
    </div>
  );
}
export function Empty({
  icon,
  hue,
  title,
  description,
  action,
  actionLabel,
  compact = false,
}: {
  icon: IconName;
  hue: Hue;
  title: string;
  description: string;
  action?: () => void;
  actionLabel?: string;
  compact?: boolean;
}) {
  return (
    <div className={`empty ${compact ? "empty-compact" : ""}`}>
      <Tile icon={icon} hue={hue} size={compact ? "lg" : "xl"} />
      <h2>{title}</h2>
      <p>{description}</p>
      {action && (
        <Button variant="outline" onClick={action}>
          {actionLabel}
          <Icon name="arrowRight" size={15} />
        </Button>
      )}
    </div>
  );
}
export function Loading({
  rows = 5,
  hero = false,
}: {
  rows?: number;
  hero?: boolean;
}) {
  return (
    <div className="loading" aria-label="Loading">
      {hero && (
        <>
          <div className="skeleton sk-eyebrow" />
          <div className="skeleton sk-title" />
          <div className="skeleton sk-hero" />
          <div className="kpis">
            {Array.from({ length: 4 }, (_, i) => (
              <div className="skeleton sk-kpi" key={i} />
            ))}
          </div>
        </>
      )}
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton sk-row" key={i} />
      ))}
    </div>
  );
}
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  full = false,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: {
    value: T;
    label: ReactNode;
    count?: number;
    dot?: string;
    disabled?: boolean;
  }[];
  full?: boolean;
  label?: string;
}) {
  return (
    <div
      className={`segmented ${full ? "segmented-full" : ""}`}
      aria-label={label}
    >
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          className={value === o.value ? "selected" : ""}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.dot && <span className={`status-dot s-${o.dot}`} />}
          {o.label}
          {o.count !== undefined && (
            <span className="mono seg-count">{o.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
export function SearchField({
  value,
  onChange,
  placeholder,
  page = true,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  page?: boolean;
  className?: string;
}) {
  return (
    <label className={`search-field ${className}`}>
      <Icon name="search" size={16} />
      <input
        data-page-search={page ? "" : undefined}
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("");
            e.currentTarget.blur();
          }
        }}
      />
      {page && <Kbd>/</Kbd>}
    </label>
  );
}
export function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="icon-button icon-button-sm"
      aria-label={label}
      title={label}
      onClick={() => void copyText(value)}
    >
      <Icon name="copy" size={15} />
    </button>
  );
}
