"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Deployment, Resource } from "@/lib/schemas";
import { Icon } from "./ui/icon";
import {
  DeploymentStatus,
  domainLabel,
  Empty,
  Menu,
  MenuItem,
  MenuSeparator,
  ResourceTile,
  resourcePath,
  Status,
  timeAgo,
} from "./kit";
import { useWorkspace } from "./workspace";

export function ResourceMenuItems({ resource }: { resource: Resource }) {
  const { run, openApp, openCoolify, busy } = useWorkspace();
  const router = useRouter();
  const deployable = resource.kind !== "database";
  return (
    <>
      {resource.domain && (
        <MenuItem icon="arrowUpRight" onSelect={() => openApp(resource)}>
          Open app
        </MenuItem>
      )}
      {deployable && (
        <MenuItem
          icon="deploy"
          disabled={busy || resource.status === "deploying"}
          onSelect={() => void run(resource, "deploy")}
        >
          Deploy
        </MenuItem>
      )}
      {resource.kind === "app" && (
        <MenuItem
          icon="bolt"
          disabled={busy || resource.status === "deploying"}
          onSelect={() => void run(resource, "force-deploy")}
        >
          Force rebuild
        </MenuItem>
      )}
      {resource.status === "stopped" ? (
        <MenuItem icon="play" onSelect={() => void run(resource, "start")}>
          Start
        </MenuItem>
      ) : (
        <>
          <MenuItem
            icon="restart"
            onSelect={() => void run(resource, "restart")}
          >
            Restart
          </MenuItem>
          <MenuItem icon="stop" onSelect={() => void run(resource, "stop")}>
            Stop
          </MenuItem>
        </>
      )}
      <MenuSeparator />
      <MenuItem
        icon="logs"
        onSelect={() => router.push(resourcePath(resource, "logs"))}
      >
        Logs
      </MenuItem>
      {resource.kind === "app" && (
        <MenuItem
          icon="globe"
          onSelect={() => router.push(resourcePath(resource, "domains"))}
        >
          Domains
        </MenuItem>
      )}
      <MenuItem
        icon="key"
        onSelect={() => router.push(resourcePath(resource, "environment"))}
      >
        Environment
      </MenuItem>
      <MenuItem
        icon="tuning"
        onSelect={() => router.push(resourcePath(resource, "configuration"))}
      >
        Configuration
      </MenuItem>
      <MenuItem
        icon="external"
        onSelect={() => openCoolify(resource.coolifyUrl)}
      >
        Open in Coolify
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon="trash"
        danger
        onSelect={() => void run(resource, "delete")}
      >
        Delete…
      </MenuItem>
    </>
  );
}

export function ResourceRows({
  resources,
  compact = false,
}: {
  resources: Resource[];
  compact?: boolean;
}) {
  const { run, openApp, busy, openCoolify } = useWorkspace();
  const router = useRouter();
  if (resources.length === 0)
    return (
      <Empty
        icon="apps"
        hue="neutral"
        title="Nothing here yet"
        description="Create a resource and it shows up here."
        action={() => router.push("/new")}
        actionLabel="New resource"
        compact
      />
    );
  return (
    <div className={`rows ${compact ? "rows-compact" : ""}`}>
      {resources.map((resource) => (
        <div
          className={`row resource-row s-${resource.status}`}
          key={resource.id}
        >
          <Link className="row-main" href={resourcePath(resource)}>
            <ResourceTile resource={resource} />
            <span className="row-text">
              <span className="row-title">{resource.name}</span>
              <span className="row-sub mono">
                {domainLabel(resource.domain) ||
                  resource.engine ||
                  resource.description ||
                  "Managed in Coolify"}
              </span>
            </span>
          </Link>
          {!compact && (
            <span className="row-meta">
              {resource.projectName && (
                <span className="meta-chip">
                  <Icon name="project" size={13} />
                  {resource.projectName}
                  {resource.environment && <span className="chip-sep">/</span>}
                  {resource.environment}
                </span>
              )}
              {resource.branch && (
                <span className="meta-chip mono">
                  <Icon name="branch" size={13} />
                  {resource.branch}
                </span>
              )}
            </span>
          )}
          <Status status={resource.status} />
          <span className="row-actions">
            {resource.kind !== "database" && (
              <button
                className="icon-button"
                aria-label={`Deploy ${resource.name}`}
                title="Deploy"
                disabled={busy || resource.status === "deploying"}
                onClick={() => void run(resource, "deploy")}
              >
                <Icon name="deploy" size={17} />
              </button>
            )}
            <Link
              className="icon-button"
              aria-label={`Logs for ${resource.name}`}
              title="Logs"
              href={resourcePath(resource, "logs")}
            >
              <Icon name="logs" size={17} />
            </Link>
            {resource.domain ? (
              <button
                className="icon-button"
                aria-label={`Open ${resource.name}`}
                title="Open"
                onClick={() => openApp(resource)}
              >
                <Icon name="arrowUpRight" size={17} />
              </button>
            ) : (
              <button
                className="icon-button"
                aria-label={`Open ${resource.name} in Coolify`}
                title="Open in Coolify"
                onClick={() => openCoolify(resource.coolifyUrl)}
              >
                <Icon name="external" size={17} />
              </button>
            )}
          </span>
          <Menu label={`Actions for ${resource.name}`}>
            <ResourceMenuItems resource={resource} />
          </Menu>
        </div>
      ))}
    </div>
  );
}

export function DeploymentRows({
  deployments,
  compact = false,
}: {
  deployments: Deployment[];
  compact?: boolean;
}) {
  if (deployments.length === 0)
    return (
      <Empty
        icon="deploy"
        hue="deploy"
        title="No deployments yet"
        description="Deployments show up here with live logs."
        compact
      />
    );
  return (
    <div className={`timeline ${compact ? "timeline-compact" : ""}`}>
      {deployments.map((d) => (
        <Link
          key={d.id}
          className={`timeline-row d-${d.status}`}
          href={`/deployments/${encodeURIComponent(d.id)}`}
        >
          <span className="timeline-node">
            <Icon
              name={
                d.status === "successful"
                  ? "check"
                  : d.status === "failed"
                    ? "cross"
                    : "refresh"
              }
              size={15}
              className={d.status === "deploying" ? "spin" : ""}
            />
          </span>
          <span className="row-text">
            <span className="row-title">{d.name}</span>
            <span className="row-sub">
              <span className="truncate">
                {d.message || "Manual deployment"}
              </span>
              {d.commit && (
                <span className="meta-chip mono">
                  <Icon name="commit" size={13} />
                  {d.commit}
                </span>
              )}
            </span>
          </span>
          {!compact && <DeploymentStatus status={d.status} />}
          <span className="timeline-time mono">
            {timeAgo(d.date)}
            {d.duration && <small>{d.duration}</small>}
          </span>
          <Icon name="chevronRight" size={14} className="row-chevron" />
        </Link>
      ))}
    </div>
  );
}
