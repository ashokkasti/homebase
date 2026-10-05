"use client";
import { useState } from "react";
import Link from "next/link";
import type { Resource } from "@/lib/schemas";
import { Icon } from "../ui/icon";
import {
  countStatuses,
  Keys,
  PageHead,
  SearchField,
  Segmented,
  capitalize,
} from "../kit";
import { ResourceRows } from "../rows";
import { useWorkspace } from "../workspace";

const copy = {
  app: {
    title: "Applications",
    icon: "apps",
    hue: "app",
    description: "Everything you’ve made a home for.",
    create: "/new/app",
    label: "application",
  },
  database: {
    title: "Databases",
    icon: "database",
    hue: "database",
    description: "The data behind your applications.",
    create: "/new/database",
    label: "database",
  },
  service: {
    title: "Services",
    icon: "service",
    hue: "service",
    description: "One-click tools that keep things running.",
    create: "/new/service",
    label: "service",
  },
} as const;

export function ResourceList({ kind }: { kind: Resource["kind"] }) {
  const { data } = useWorkspace();
  const [status, setStatus] = useState<"all" | Resource["status"]>("all");
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("all");
  const resources = data.resources.filter((r) => r.kind === kind);
  const counts = countStatuses(resources);
  const projects = [
    ...new Set(resources.map((r) => r.projectName).filter(Boolean)),
  ];
  const term = search.toLowerCase();
  const visible = resources.filter(
    (r) =>
      (status === "all" || r.status === status) &&
      (project === "all" || r.projectName === project) &&
      `${r.name} ${r.domain} ${r.description} ${r.environment}`
        .toLowerCase()
        .includes(term),
  );
  const c = copy[kind];
  return (
    <>
      <PageHead
        icon={c.icon}
        hue={c.hue}
        title={c.title}
        count={resources.length}
        description={c.description}
      >
        <Link className="button button-default" href={c.create}>
          <Icon name="plus" size={16} />
          New {c.label}
          <Keys keys={["C"]} />
        </Link>
      </PageHead>
      <div className="toolbar">
        <Segmented
          value={status}
          onChange={setStatus}
          label="Status filter"
          options={(
            ["all", "running", "deploying", "stopped", "failed"] as const
          ).map((f) => ({
            value: f,
            label: f === "all" ? "All" : capitalize(f),
            count: f === "all" ? resources.length : counts[f],
            dot: f === "all" ? undefined : f,
          }))}
        />
        <div className="toolbar-right">
          {projects.length > 1 && (
            <select
              className="mini-select"
              aria-label="Project filter"
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              <option value="all">All projects</option>
              {projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={`Filter ${c.title.toLowerCase()}…`}
          />
        </div>
      </div>
      <section className="panel panel-flush">
        <ResourceRows resources={visible} />
      </section>
      <div className="list-foot">
        <span className="live-dot on" />
        Synced with {data.demo ? "your demo workspace" : "Coolify"}
        <span className="mono">· refreshes every 20s</span>
      </div>
    </>
  );
}
