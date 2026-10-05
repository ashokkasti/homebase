"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import {
  Empty,
  Loading,
  Menu,
  MenuItem,
  MenuSeparator,
  PageHead,
  ResourceTile,
  resourcePath,
  SearchField,
  Tile,
} from "../kit";
import { useConfirm } from "../confirm";
import { okSchema, useMeta, useWorkspace } from "../workspace";

export function ProjectsPage() {
  const { data, invalidate } = useWorkspace();
  const meta = useMeta();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [addingEnv, setAddingEnv] = useState<string | null>(null);
  const [envName, setEnvName] = useState("");
  const [search, setSearch] = useState("");
  const mutation = useMutation({
    mutationFn: (body: unknown) => api("projects", okSchema, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["meta"] });
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  // Breadcrumb menus link here with #project-… or #env-…; bring it into view.
  const ready = !!meta.data;
  useEffect(() => {
    if (!ready || !window.location.hash) return;
    const target = document.getElementById(
      decodeURIComponent(window.location.hash.slice(1)),
    );
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.add("flash");
    const timer = window.setTimeout(
      () => target.classList.remove("flash"),
      1600,
    );
    return () => window.clearTimeout(timer);
  }, [ready]);
  if (meta.isLoading) return <Loading rows={4} />;
  if (meta.isError)
    return (
      <Empty
        icon="project"
        hue="red"
        title="Projects unavailable"
        description={meta.error.message}
        action={() => void meta.refetch()}
        actionLabel="Try again"
      />
    );
  const term = search.toLowerCase();
  const projects = (meta.data?.projects ?? []).filter((p) =>
    `${p.name} ${p.description}`.toLowerCase().includes(term),
  );
  return (
    <>
      <PageHead
        icon="project"
        hue="project"
        title="Projects"
        count={meta.data?.projects.length}
        description="Group resources by project and environment."
      >
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Filter projects…"
        />
        <Button onClick={() => setCreating(true)} disabled={creating}>
          <Icon name="plus" size={16} />
          New project
        </Button>
      </PageHead>
      {creating && (
        <form
          className="panel inline-form create-project"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(
              { op: "create", name, description },
              {
                onSuccess: () => {
                  toast.success(`${name} created`);
                  setCreating(false);
                  setName("");
                  setDescription("");
                },
              },
            );
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>Name</span>
              <input
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Side projects"
              />
            </label>
            <label className="field">
              <span>Description</span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>
          <div className="dialog-actions">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || !name.trim()}>
              Create project
            </Button>
          </div>
        </form>
      )}
      {projects.length === 0 ? (
        <Empty
          icon="project"
          hue="project"
          title="No projects"
          description="Projects hold environments, which hold your resources."
          action={() => setCreating(true)}
          actionLabel="Create a project"
        />
      ) : (
        <div className="project-list">
          {projects.map((project) => {
            const resources = data.resources.filter(
              (r) => r.projectId === project.id,
            );
            return (
              <section
                className="panel project"
                key={project.id}
                id={`project-${project.id}`}
              >
                <div className="project-head">
                  <Tile icon="project" hue="project" />
                  <span className="row-text">
                    <span className="row-title">{project.name}</span>
                    <span className="row-sub">
                      {project.description ||
                        `${project.environments.length} environment${project.environments.length === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <span className="mono muted small">
                    {resources.length} resources
                  </span>
                  <Menu label={`Actions for ${project.name}`}>
                    <MenuItem
                      icon="addWidget"
                      onSelect={() => setAddingEnv(project.id)}
                    >
                      Add environment
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem
                      icon="trash"
                      danger
                      onSelect={async () => {
                        const ok = await confirm({
                          title: `Delete ${project.name}?`,
                          description: resources.length
                            ? `Coolify refuses while ${resources.length} resources remain. Delete or move them first.`
                            : "The project and its empty environments are removed.",
                          confirmLabel: "Delete project",
                          icon: "trash",
                          typeToConfirm: project.name,
                        });
                        if (ok)
                          mutation.mutate(
                            {
                              op: "delete",
                              projectId: project.id,
                              confirmation: project.name,
                            },
                            {
                              onSuccess: () =>
                                toast.success(`${project.name} deleted`),
                            },
                          );
                      }}
                    >
                      Delete project…
                    </MenuItem>
                  </Menu>
                </div>
                <div className="env-columns">
                  {project.environments.map((env) => {
                    const items = resources.filter(
                      (r) =>
                        r.environmentId === env.id ||
                        (!r.environmentId && r.environment === env.name),
                    );
                    return (
                      <div
                        className="env-column"
                        key={env.id}
                        id={`env-${env.id}`}
                      >
                        <div className="env-column-head">
                          <span className="env-name mono">{env.name}</span>
                          <span className="count">{items.length}</span>
                          <span className="console-spacer" />
                          <Link
                            className="icon-button icon-button-sm"
                            title="New resource here"
                            aria-label={`New resource in ${env.name}`}
                            href={`/new?project=${encodeURIComponent(project.id)}&environment=${encodeURIComponent(env.id)}`}
                          >
                            <Icon name="plus" size={15} />
                          </Link>
                          {items.length === 0 && (
                            <button
                              className="icon-button icon-button-sm danger-hover"
                              aria-label={`Delete ${env.name}`}
                              title="Delete environment"
                              onClick={async () => {
                                const ok = await confirm({
                                  title: `Delete ${env.name}?`,
                                  description: `The environment is removed from ${project.name}.`,
                                  confirmLabel: "Delete environment",
                                  icon: "trash",
                                  typeToConfirm: env.name,
                                });
                                if (ok)
                                  mutation.mutate({
                                    op: "delete-environment",
                                    projectId: project.id,
                                    environment: env.name,
                                    confirmation: env.name,
                                  });
                              }}
                            >
                              <Icon name="trash" size={14} />
                            </button>
                          )}
                        </div>
                        {items.length === 0 ? (
                          <p className="env-empty">Empty</p>
                        ) : (
                          items.map((r) => (
                            <Link
                              key={r.id}
                              className="mini-row"
                              href={resourcePath(r)}
                            >
                              <ResourceTile resource={r} size="sm" />
                              <span className="truncate">{r.name}</span>
                              <span
                                className={`status-dot s-${r.status}`}
                                title={r.status}
                              />
                            </Link>
                          ))
                        )}
                      </div>
                    );
                  })}
                  {addingEnv === project.id && (
                    <form
                      className="env-column env-new"
                      onSubmit={(e) => {
                        e.preventDefault();
                        mutation.mutate(
                          {
                            op: "create-environment",
                            projectId: project.id,
                            name: envName,
                          },
                          {
                            onSuccess: () => {
                              toast.success(`${envName} added`);
                              setAddingEnv(null);
                              setEnvName("");
                            },
                          },
                        );
                      }}
                    >
                      <input
                        autoFocus
                        className="mono"
                        placeholder="staging"
                        value={envName}
                        onChange={(e) => setEnvName(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Escape" && setAddingEnv(null)
                        }
                      />
                      <Button
                        size="sm"
                        type="submit"
                        disabled={!envName.trim() || mutation.isPending}
                      >
                        Add
                      </Button>
                    </form>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
