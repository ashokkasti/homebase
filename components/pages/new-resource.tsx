"use client";
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { serviceTemplates } from "@/lib/service-templates";
import {
  databaseEngineSchema,
  type CreateInput,
  type Kind,
} from "@/lib/schemas";
import { Button } from "../ui/button";
import { Icon, type IconName } from "../ui/icon";
import {
  Empty,
  Keys,
  Loading,
  PageHead,
  resourcePath,
  SearchField,
  Segmented,
  Switch,
  Tile,
  type Hue,
} from "../kit";
import { useMeta } from "../workspace";

const appSources: {
  id: string;
  title: string;
  text: string;
  icon: IconName;
  hue: Hue;
}[] = [
  {
    id: "git",
    title: "Public repository",
    text: "Any public Git URL. Built with Nixpacks, Dockerfile or Compose.",
    icon: "branch",
    hue: "app",
  },
  {
    id: "github",
    title: "Private repository",
    text: "Through a GitHub App connected to Coolify.",
    icon: "lock",
    hue: "app",
  },
  {
    id: "image",
    title: "Docker image",
    text: "Run a prebuilt image from any registry.",
    icon: "box",
    hue: "service",
  },
  {
    id: "dockerfile",
    title: "Dockerfile",
    text: "Paste a Dockerfile, no repository needed.",
    icon: "file",
    hue: "accent",
  },
];
const engines: {
  id: string;
  title: string;
  text: string;
  image: string;
  port: number;
}[] = [
  {
    id: "postgresql",
    title: "PostgreSQL",
    text: "The reliable relational default.",
    image: "postgres:17-alpine",
    port: 5432,
  },
  {
    id: "mysql",
    title: "MySQL",
    text: "Popular relational database.",
    image: "mysql:8",
    port: 3306,
  },
  {
    id: "mariadb",
    title: "MariaDB",
    text: "Community fork of MySQL.",
    image: "mariadb:11",
    port: 3306,
  },
  {
    id: "mongodb",
    title: "MongoDB",
    text: "Document database.",
    image: "mongo:7",
    port: 27017,
  },
  {
    id: "redis",
    title: "Redis",
    text: "In-memory cache and queues.",
    image: "redis:7.4-alpine",
    port: 6379,
  },
  {
    id: "keydb",
    title: "KeyDB",
    text: "Multithreaded Redis fork.",
    image: "eqalpha/keydb:latest",
    port: 6379,
  },
  {
    id: "dragonfly",
    title: "Dragonfly",
    text: "Fast Redis-compatible store.",
    image: "docker.dragonflydb.io/dragonflydb/dragonfly",
    port: 6379,
  },
  {
    id: "clickhouse",
    title: "ClickHouse",
    text: "Column store for analytics.",
    image: "clickhouse/clickhouse-server",
    port: 8123,
  },
];
function pretty(slug: string) {
  return slug
    .split("-")
    .map((w) =>
      w === "with" || w === "and" ? w : w[0]?.toUpperCase() + w.slice(1),
    )
    .join(" ");
}
function hueOf(text: string) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function LetterTile({ name, seed }: { name: string; seed: string }) {
  return (
    <span
      className="tile tile-md letter-tile"
      style={{ ["--h" as string]: hueOf(seed) }}
      aria-hidden
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function NewResource({ parts }: { parts: string[] }) {
  const [type, variant] = parts;
  if (type && variant)
    return (
      <CreateForm
        type={type as "app" | "database" | "service"}
        variant={variant}
      />
    );
  return <Picker focus={type} />;
}

function Picker({ focus }: { focus?: string }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [limit, setLimit] = useState(48);
  const search_ = useSearchParams();
  const qs = search_.toString() ? `?${search_.toString()}` : "";
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [, , c] of serviceTemplates)
      counts.set(c.toLowerCase(), (counts.get(c.toLowerCase()) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9);
  }, []);
  const term = search.toLowerCase();
  const services = serviceTemplates.filter(
    ([slug, slogan, c]) =>
      (category === "all" || c.toLowerCase() === category) &&
      `${slug} ${slogan} ${c}`.toLowerCase().includes(term),
  );
  const show = (group: string) => !focus || focus === group;
  return (
    <>
      <PageHead
        icon="addWidget"
        hue="accent"
        title="New resource"
        description="Ship something new to your server."
      >
        <Keys keys={["C"]} />
      </PageHead>
      {show("app") && (
        <section className="new-group">
          <h2>
            <Tile icon="apps" hue="app" size="sm" />
            Application
          </h2>
          <div className="choice-grid choice-grid-4">
            {appSources.map((s) => (
              <Link
                key={s.id}
                className={`choice hue-${s.hue}`}
                href={`/new/app/${s.id}${qs}`}
              >
                <Tile icon={s.icon} hue={s.hue} />
                <span className="row-text">
                  <span className="row-title">{s.title}</span>
                  <span className="row-sub wrap">{s.text}</span>
                </span>
                <Icon name="arrowRight" size={15} className="choice-arrow" />
              </Link>
            ))}
          </div>
        </section>
      )}
      {show("database") && (
        <section className="new-group">
          <h2>
            <Tile icon="database" hue="database" size="sm" />
            Database
          </h2>
          <div className="choice-grid choice-grid-4">
            {engines.map((e) => (
              <Link
                key={e.id}
                className="choice hue-database"
                href={`/new/database/${e.id}${qs}`}
              >
                <LetterTile name={e.title} seed={e.id} />
                <span className="row-text">
                  <span className="row-title">{e.title}</span>
                  <span className="row-sub wrap">{e.text}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {show("service") && (
        <section className="new-group">
          <div className="new-group-head">
            <h2>
              <Tile icon="service" hue="service" size="sm" />
              One-click service
              <span className="count">{serviceTemplates.length}</span>
            </h2>
            <SearchField
              value={search}
              onChange={(v) => {
                setSearch(v);
                setLimit(48);
              }}
              placeholder="Search n8n, Plausible, Gitea…"
            />
          </div>
          <div className="chips">
            {[["all", serviceTemplates.length] as const, ...categories].map(
              ([c, n]) => (
                <button
                  key={c}
                  className={`chip ${category === c ? "selected" : ""}`}
                  onClick={() => setCategory(c)}
                >
                  {c === "all" ? "All" : c.length <= 3 ? c.toUpperCase() : c}
                  <span className="mono">{n}</span>
                </button>
              ),
            )}
          </div>
          <div className="choice-grid choice-grid-3">
            <Link
              className="choice choice-dashed hue-accent"
              href={`/new/service/compose${qs}`}
            >
              <Tile icon="file" hue="accent" />
              <span className="row-text">
                <span className="row-title">Custom docker-compose</span>
                <span className="row-sub wrap">
                  Paste your own compose file.
                </span>
              </span>
            </Link>
            {services.slice(0, limit).map(([slug, slogan, c]) => (
              <Link
                key={slug}
                className="choice hue-service"
                href={`/new/service/${slug}${qs}`}
              >
                <LetterTile name={slug} seed={c} />
                <span className="row-text">
                  <span className="row-title">{pretty(slug)}</span>
                  <span className="row-sub wrap clamp">{slogan || c}</span>
                </span>
              </Link>
            ))}
          </div>
          {services.length > limit && (
            <div className="more">
              <Button variant="outline" onClick={() => setLimit(limit + 96)}>
                Show more
                <span className="mono muted">{services.length - limit}</span>
              </Button>
            </div>
          )}
          {services.length === 0 && (
            <p className="muted small">
              No template matches. Paste a{" "}
              <Link className="text-link" href={`/new/service/compose${qs}`}>
                custom compose file
              </Link>{" "}
              instead.
            </p>
          )}
        </section>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="config-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

const createResult = z.object({
  ok: z.boolean(),
  id: z.string(),
  kind: z.enum(["app", "database", "service"]),
  deploymentId: z.string().optional(),
});

function CreateForm({
  type,
  variant,
}: {
  type: "app" | "database" | "service";
  variant: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const meta = useMeta();
  const [projectId, setProjectId] = useState(params.get("project") ?? "");
  const [environmentId, setEnvironmentId] = useState(
    params.get("environment") ?? "",
  );
  const [serverId, setServerId] = useState("");
  const [f, setF] = useState({
    name: "",
    description: "",
    gitRepository: "",
    gitBranch: "main",
    buildPack: "nixpacks",
    baseDirectory: "/",
    githubAppId: "",
    image: "",
    tag: "latest",
    dockerfile: "FROM nginx:alpine\nCOPY . /usr/share/nginx/html\nEXPOSE 80\n",
    portsExposes: variant === "dockerfile" ? "80" : "3000",
    domains: "",
    dbImage: "",
    isPublic: false,
    publicPort: "",
    compose:
      "services:\n  app:\n    image: nginx:alpine\n    environment:\n      - SERVICE_FQDN_APP_80\n",
    instantDeploy: true,
  });
  const set = <K extends keyof typeof f>(key: K, value: (typeof f)[K]) =>
    setF((s) => ({ ...s, [key]: value }));
  const mutation = useMutation({
    mutationFn: (input: CreateInput) =>
      api("resources/create", createResult, input),
    onSuccess: (result) => {
      toast.success("Resource created");
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["meta"] });
      router.push(
        result.deploymentId
          ? `/deployments/${encodeURIComponent(result.deploymentId)}`
          : resourcePath({ kind: result.kind as Kind, id: result.id }),
      );
    },
    onError: (error) => toast.error(error.message),
  });
  if (meta.isLoading) return <Loading rows={6} />;
  if (meta.isError || !meta.data)
    return (
      <Empty
        icon="project"
        hue="red"
        title="Couldn’t load projects and servers"
        description={meta.error?.message ?? ""}
        action={() => void meta.refetch()}
        actionLabel="Try again"
      />
    );
  const projects = meta.data.projects;
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const environment =
    project?.environments.find((e) => e.id === environmentId) ??
    project?.environments[0];
  const server =
    meta.data.servers.find((s) => s.id === serverId) ?? meta.data.servers[0];
  const engine = engines.find((e) => e.id === variant);
  const template = serviceTemplates.find(([slug]) => slug === variant);
  const source = appSources.find((s) => s.id === variant);
  const title =
    type === "app"
      ? (source?.title ?? "Application")
      : type === "database"
        ? (engine?.title ?? "Database")
        : variant === "compose"
          ? "Custom compose"
          : pretty(variant);
  if ((type === "app" && !source) || (type === "database" && !engine))
    return (
      <Empty
        icon="search"
        hue="neutral"
        title="Unknown resource type"
        description="Pick a type from the catalog."
        action={() => router.push("/new")}
        actionLabel="Browse"
      />
    );
  function submit() {
    if (!project || !environment || !server) {
      toast.error("Choose a project, environment and server.");
      return;
    }
    const location = {
      projectId: project.id,
      environmentId: environment.id,
      environmentName: environment.name,
      serverId: server.id,
      name: f.name,
      description: f.description,
      instantDeploy: f.instantDeploy,
    };
    const app = {
      ...location,
      portsExposes: f.portsExposes,
      domains: f.domains,
    };
    const input: CreateInput =
      type === "database"
        ? {
            type: "database",
            ...location,
            engine: databaseEngineSchema.parse(variant),
            image: f.dbImage,
            isPublic: f.isPublic,
            publicPort:
              f.isPublic && f.publicPort ? Number(f.publicPort) : undefined,
          }
        : type === "service"
          ? variant === "compose"
            ? { type: "service", ...location, compose: f.compose }
            : { type: "service", ...location, serviceType: variant }
          : variant === "image"
            ? { type: "app-image", ...app, image: f.image, tag: f.tag }
            : variant === "dockerfile"
              ? { type: "app-dockerfile", ...app, dockerfile: f.dockerfile }
              : {
                  type: "app-git",
                  ...app,
                  gitRepository: f.gitRepository,
                  gitBranch: f.gitBranch,
                  buildPack: f.buildPack as "nixpacks",
                  baseDirectory: f.baseDirectory,
                  githubAppId:
                    variant === "github"
                      ? f.githubAppId || meta.data?.githubApps[0]?.id
                      : undefined,
                };
    mutation.mutate(input);
  }
  return (
    <>
      <Link className="back-link" href={`/new/${type}`}>
        <Icon name="arrowLeft" size={15} />
        New {type === "app" ? "application" : type}
      </Link>
      <PageHead
        icon={
          type === "app"
            ? (source?.icon ?? "apps")
            : type === "database"
              ? "database"
              : "service"
        }
        hue={
          type === "app" ? "app" : type === "database" ? "database" : "service"
        }
        title={title}
        description={
          type === "service" && template
            ? template[1]
            : type === "database"
              ? (engine?.text ?? "")
              : (source?.text ?? "")
        }
      />
      <form
        className="create"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="config-main">
          {type === "app" &&
            variant !== "image" &&
            variant !== "dockerfile" && (
              <Section title="Source">
                <div className="config-grid">
                  {variant === "github" && (
                    <label className="config-field">
                      <span className="field-label">GitHub App</span>
                      {meta.data.githubApps.length === 0 ? (
                        <span className="hint">
                          No private GitHub Apps are connected. Add one in
                          Coolify → Sources.
                        </span>
                      ) : (
                        <select
                          value={f.githubAppId}
                          onChange={(e) => set("githubAppId", e.target.value)}
                        >
                          {meta.data.githubApps.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </label>
                  )}
                  <label className="config-field wide">
                    <span className="field-label">Repository</span>
                    <input
                      className="mono"
                      required
                      autoFocus
                      placeholder={
                        variant === "github"
                          ? "owner/repository"
                          : "https://github.com/coollabsio/coolify-examples"
                      }
                      value={f.gitRepository}
                      onChange={(e) => set("gitRepository", e.target.value)}
                    />
                  </label>
                  <label className="config-field">
                    <span className="field-label">Branch</span>
                    <input
                      className="mono"
                      required
                      value={f.gitBranch}
                      onChange={(e) => set("gitBranch", e.target.value)}
                    />
                  </label>
                  <label className="config-field">
                    <span className="field-label">Base directory</span>
                    <input
                      className="mono"
                      value={f.baseDirectory}
                      onChange={(e) => set("baseDirectory", e.target.value)}
                    />
                  </label>
                  <div className="config-field wide">
                    <span className="field-label">Build pack</span>
                    <Segmented
                      value={f.buildPack}
                      onChange={(v) => set("buildPack", v)}
                      options={[
                        { value: "nixpacks", label: "Nixpacks" },
                        { value: "railpack", label: "Railpack" },
                        { value: "static", label: "Static" },
                        { value: "dockerfile", label: "Dockerfile" },
                        { value: "dockercompose", label: "Compose" },
                      ]}
                    />
                  </div>
                </div>
              </Section>
            )}
          {variant === "image" && (
            <Section title="Image">
              <div className="config-grid">
                <label className="config-field wide">
                  <span className="field-label">Image</span>
                  <input
                    className="mono"
                    required
                    autoFocus
                    placeholder="ghcr.io/owner/app"
                    value={f.image}
                    onChange={(e) => set("image", e.target.value)}
                  />
                </label>
                <label className="config-field">
                  <span className="field-label">Tag</span>
                  <input
                    className="mono"
                    value={f.tag}
                    onChange={(e) => set("tag", e.target.value)}
                  />
                </label>
              </div>
            </Section>
          )}
          {variant === "dockerfile" && (
            <Section title="Dockerfile">
              <textarea
                className="code-input"
                rows={12}
                spellCheck={false}
                value={f.dockerfile}
                onChange={(e) => set("dockerfile", e.target.value)}
              />
            </Section>
          )}
          {type === "service" && variant === "compose" && (
            <Section title="docker-compose.yml">
              <textarea
                className="code-input"
                rows={16}
                spellCheck={false}
                value={f.compose}
                onChange={(e) => set("compose", e.target.value)}
              />
              <small className="hint">
                Use <code>SERVICE_FQDN_&lt;NAME&gt;_&lt;PORT&gt;</code>{" "}
                variables to let Coolify generate domains.
              </small>
            </Section>
          )}
          {type === "app" && (
            <Section title="Network">
              <div className="config-grid">
                <label className="config-field">
                  <span className="field-label">Exposed port</span>
                  <input
                    className="mono"
                    required
                    value={f.portsExposes}
                    onChange={(e) => set("portsExposes", e.target.value)}
                  />
                </label>
                <label className="config-field wide">
                  <span className="field-label">Domains</span>
                  <input
                    className="mono"
                    placeholder="https://app.example.com (blank = generated)"
                    value={f.domains}
                    onChange={(e) => set("domains", e.target.value)}
                  />
                </label>
              </div>
            </Section>
          )}
          {type === "database" && (
            <Section title="Database">
              <div className="config-grid">
                <label className="config-field wide">
                  <span className="field-label">Image</span>
                  <input
                    className="mono"
                    placeholder={engine?.image}
                    value={f.dbImage}
                    onChange={(e) => set("dbImage", e.target.value)}
                  />
                  <small className="hint">
                    Leave blank for Coolify’s default. Credentials are generated
                    for you.
                  </small>
                </label>
                <div className="config-field bool-field">
                  <span className="row-text">
                    <span className="row-title">Publicly accessible</span>
                    <span className="row-sub wrap">
                      Expose the port on the server’s IP.
                    </span>
                  </span>
                  <Switch
                    checked={f.isPublic}
                    onChange={(v) => set("isPublic", v)}
                    label="Publicly accessible"
                  />
                </div>
                {f.isPublic && (
                  <label className="config-field">
                    <span className="field-label">Public port</span>
                    <input
                      className="mono"
                      type="number"
                      placeholder={String(engine?.port)}
                      value={f.publicPort}
                      onChange={(e) => set("publicPort", e.target.value)}
                    />
                  </label>
                )}
              </div>
            </Section>
          )}
          <Section title="Details">
            <div className="config-grid">
              <label className="config-field">
                <span className="field-label">Name</span>
                <input
                  placeholder="Generated if empty"
                  value={f.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </label>
              <label className="config-field wide">
                <span className="field-label">Description</span>
                <input
                  value={f.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </label>
            </div>
          </Section>
        </div>
        <aside className="create-aside">
          <div className="info-card">
            <h3>Destination</h3>
            <label className="field">
              <span>Project</span>
              <select
                value={project?.id ?? ""}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setEnvironmentId("");
                }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Environment</span>
              <select
                value={environment?.id ?? ""}
                onChange={(e) => setEnvironmentId(e.target.value)}
              >
                {project?.environments.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Server</span>
              <select
                value={server?.id ?? ""}
                onChange={(e) => setServerId(e.target.value)}
              >
                {meta.data.servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.ip ? `· ${s.ip}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="bool-field">
              <span className="row-text">
                <span className="row-title">
                  {type === "app" ? "Deploy now" : "Start now"}
                </span>
                <span className="row-sub wrap">
                  Skip to tweak env vars first.
                </span>
              </span>
              <Switch
                checked={f.instantDeploy}
                onChange={(v) => set("instantDeploy", v)}
                label="Deploy immediately"
              />
            </div>
            <Button
              type="submit"
              disabled={mutation.isPending || !project || !server}
            >
              <Icon
                name={type === "database" ? "database" : "deploy"}
                size={16}
              />
              {mutation.isPending
                ? "Creating…"
                : `Create ${type === "app" ? "application" : type}`}
            </Button>
            {projects.length === 0 && (
              <p className="hint">
                Create a project first on the{" "}
                <Link className="text-link" href="/projects">
                  projects page
                </Link>
                .
              </p>
            )}
          </div>
        </aside>
      </form>
    </>
  );
}
