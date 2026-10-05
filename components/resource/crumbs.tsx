"use client";
// Clickable "KIND / PROJECT / ENVIRONMENT" trail on resource pages. Each segment
// opens a menu for moving sideways: sibling resources, other projects, or the
// same resource in another environment.
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import type { Resource } from "@/lib/schemas";
import { Icon } from "../ui/icon";
import {
  kindLabel,
  kindSection,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  ResourceTile,
  resourcePath,
} from "../kit";
import { useMeta, useWorkspace } from "../workspace";

function Segment({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="crumb-trigger">
        {label}
        <Icon name="chevronDown" size={11} />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="menu crumb-menu"
          align="start"
          sideOffset={6}
          collisionPadding={12}
        >
          {children}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

function ResourceItem({
  resource,
  current,
  hint,
}: {
  resource: Resource;
  current: boolean;
  hint?: string;
}) {
  const router = useRouter();
  return (
    <Dropdown.Item
      className={`menu-item crumb-item ${current ? "current" : ""}`}
      onSelect={() => router.push(resourcePath(resource))}
    >
      <ResourceTile resource={resource} size="sm" />
      <span className="crumb-item-text">
        <span className="truncate">{resource.name}</span>
        {hint && <small className="truncate">{hint}</small>}
      </span>
      <span className={`status-dot s-${resource.status}`} />
      {current && <Icon name="check" size={14} className="crumb-check" />}
    </Dropdown.Item>
  );
}

export function ResourceCrumbs({ resource }: { resource: Resource }) {
  const router = useRouter();
  const { data } = useWorkspace();
  const meta = useMeta();
  const siblings = data.resources.filter((r) => r.kind === resource.kind);
  const sameProject = siblings.filter(
    (r) => r.projectId && r.projectId === resource.projectId,
  );
  const others = siblings.filter((r) => !sameProject.includes(r));
  const projects =
    meta.data?.projects ??
    [
      ...new Map(
        data.resources.filter((r) => r.projectId).map((r) => [r.projectId, r]),
      ).values(),
    ].map((r) => ({
      id: r.projectId,
      name: r.projectName,
      description: "",
      environments: [],
    }));
  const project = projects.find((p) => p.id === resource.projectId);
  const environments =
    project && project.environments.length
      ? project.environments
      : [
          ...new Map(
            data.resources
              .filter(
                (r) => r.projectId === resource.projectId && r.environmentId,
              )
              .map((r) => [
                r.environmentId,
                { id: r.environmentId, name: r.environment },
              ]),
          ).values(),
        ];
  // Same resource in another environment: Coolify suffixes clones, so match on
  // the name before any ":" or "-<env>" decoration as well as the exact name.
  const stem = (name: string) =>
    name.toLowerCase().split(":")[0]?.trim() ?? name;
  const counterpart = (environmentId: string) =>
    data.resources.find(
      (r) =>
        r.kind === resource.kind &&
        r.projectId === resource.projectId &&
        r.environmentId === environmentId &&
        (r.name === resource.name || stem(r.name) === stem(resource.name)),
    );
  const label = kindLabel(resource.kind);
  return (
    <nav className="eyebrow eyebrow-crumbs" aria-label="Resource location">
      <Segment label={label}>
        <MenuItem
          icon="list"
          onSelect={() => router.push(`/${kindSection(resource.kind)}`)}
        >
          All {label.toLowerCase()}s
          <span className="crumb-count mono">{siblings.length}</span>
        </MenuItem>
        {sameProject.length > 0 && (
          <>
            <MenuSeparator />
            <MenuLabel>In {resource.projectName || "this project"}</MenuLabel>
            <div className="crumb-scroll">
              {sameProject.map((r) => (
                <ResourceItem
                  key={r.id}
                  resource={r}
                  current={r.id === resource.id}
                  hint={r.environment}
                />
              ))}
            </div>
          </>
        )}
        {others.length > 0 && (
          <>
            <MenuSeparator />
            <MenuLabel>Elsewhere</MenuLabel>
            <div className="crumb-scroll">
              {others.map((r) => (
                <ResourceItem
                  key={r.id}
                  resource={r}
                  current={r.id === resource.id}
                  hint={[r.projectName, r.environment]
                    .filter(Boolean)
                    .join(" / ")}
                />
              ))}
            </div>
          </>
        )}
      </Segment>
      {resource.projectName && (
        <>
          <span className="eyebrow-sep">/</span>
          <Segment label={resource.projectName}>
            <MenuLabel>Projects</MenuLabel>
            <div className="crumb-scroll">
              {projects.map((p) => {
                const count = data.resources.filter(
                  (r) => r.projectId === p.id,
                ).length;
                const current = p.id === resource.projectId;
                return (
                  <Dropdown.Item
                    key={p.id}
                    className={`menu-item crumb-item ${current ? "current" : ""}`}
                    onSelect={() =>
                      router.push(
                        `/projects#project-${encodeURIComponent(p.id)}`,
                      )
                    }
                  >
                    <Icon name="project" size={16} />
                    <span className="crumb-item-text">
                      <span className="truncate">{p.name}</span>
                    </span>
                    <span className="crumb-count mono">{count}</span>
                    {current && (
                      <Icon name="check" size={14} className="crumb-check" />
                    )}
                  </Dropdown.Item>
                );
              })}
            </div>
            <MenuSeparator />
            <MenuItem icon="plus" onSelect={() => router.push("/projects")}>
              Manage projects
            </MenuItem>
          </Segment>
        </>
      )}
      {resource.environment && (
        <>
          <span className="eyebrow-sep">/</span>
          <Segment label={resource.environment}>
            <MenuLabel>
              Environments in {resource.projectName || "project"}
            </MenuLabel>
            <div className="crumb-scroll">
              {environments.map((env) => {
                const current = env.id === resource.environmentId;
                const match = current ? resource : counterpart(env.id);
                const count = data.resources.filter(
                  (r) => r.environmentId === env.id,
                ).length;
                return (
                  <Dropdown.Item
                    key={env.id}
                    className={`menu-item crumb-item ${current ? "current" : ""}`}
                    onSelect={() =>
                      router.push(
                        match
                          ? resourcePath(match)
                          : `/projects#env-${encodeURIComponent(env.id)}`,
                      )
                    }
                  >
                    <span className={`env-dot ${match ? "on" : ""}`} />
                    <span className="crumb-item-text">
                      <span className="truncate mono">{env.name}</span>
                      <small className="truncate">
                        {current
                          ? "You are here"
                          : match
                            ? `Open ${match.name}`
                            : `${count} resource${count === 1 ? "" : "s"} · no copy of this one`}
                      </small>
                    </span>
                    {current && (
                      <Icon name="check" size={14} className="crumb-check" />
                    )}
                  </Dropdown.Item>
                );
              })}
            </div>
            {resource.projectId && (
              <>
                <MenuSeparator />
                <MenuItem
                  icon="plus"
                  onSelect={() =>
                    router.push(
                      `/new?project=${encodeURIComponent(resource.projectId)}&environment=${encodeURIComponent(resource.environmentId)}`,
                    )
                  }
                >
                  New resource in {resource.environment}
                </MenuItem>
              </>
            )}
          </Segment>
        </>
      )}
    </nav>
  );
}
