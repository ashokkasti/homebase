"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  deploymentDetailSchema,
  type DeploymentDetail,
  type LogLine,
} from "@/lib/schemas";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import {
  capitalize,
  DeploymentStatus,
  Empty,
  formatDate,
  formatDuration,
  Loading,
  PageHead,
  resourcePath,
  SearchField,
  Segmented,
  Tile,
  useNow,
} from "../kit";
import { DeploymentRows } from "../rows";
import { LogConsole } from "../log-console";
import { useConfirm } from "../confirm";
import { okSchema, useWorkspace } from "../workspace";

export function DeploymentList() {
  const { data } = useWorkspace();
  const [filter, setFilter] = useState<
    "all" | "successful" | "failed" | "deploying"
  >("all");
  const [search, setSearch] = useState("");
  const finished = data.deployments.filter(
    (d) => d.status === "successful" || d.status === "failed",
  );
  const rate = finished.length
    ? Math.round(
        (finished.filter((d) => d.status === "successful").length /
          finished.length) *
          100,
      )
    : null;
  const term = search.toLowerCase();
  const visible = data.deployments.filter(
    (d) =>
      (filter === "all" ||
        d.status === filter ||
        (filter === "deploying" && d.status === "queued")) &&
      `${d.name} ${d.message} ${d.commit}`.toLowerCase().includes(term),
  );
  return (
    <>
      <PageHead
        icon="deploy"
        hue="deploy"
        title="Deployments"
        count={data.deployments.length}
        description="Every build, with live logs."
      >
        {rate !== null && (
          <div className="head-stat">
            <strong className="mono">{rate}%</strong>
            <span>success rate</span>
          </div>
        )}
      </PageHead>
      <div className="toolbar">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={(["all", "successful", "failed", "deploying"] as const).map(
            (f) => ({
              value: f,
              label: capitalize(f),
              dot: f === "all" ? undefined : f === "successful" ? "running" : f,
              count:
                f === "all"
                  ? data.deployments.length
                  : data.deployments.filter(
                      (d) =>
                        d.status === f ||
                        (f === "deploying" && d.status === "queued"),
                    ).length,
            }),
          )}
        />
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Filter by app, commit, message…"
        />
      </div>
      <section className="panel panel-flush">
        <DeploymentRows deployments={visible} />
      </section>
    </>
  );
}

const phases = [
  { id: "queued", label: "Queued", icon: "clock" },
  { id: "source", label: "Source", icon: "branch" },
  { id: "build", label: "Build", icon: "box" },
  { id: "release", label: "Release", icon: "deploy" },
  { id: "live", label: "Live", icon: "check" },
] as const;
function phaseOf(detail: DeploymentDetail, lines: LogLine[]) {
  if (detail.status === "successful") return 4;
  const text = lines.map((l) => l.text.toLowerCase()).join("\n");
  if (
    /rolling update|healthcheck|new container started|starting container|container .* started/.test(
      text,
    )
  )
    return 3;
  if (/building docker image|nixpacks|docker build|#\d+ \[/.test(text))
    return 2;
  if (/importing|cloning|git |pulling image/.test(text)) return 1;
  return detail.status === "queued" ? 0 : lines.length ? 1 : 0;
}

export function DeploymentPage({ id }: { id: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const { data, run, invalidate, openApp } = useWorkspace();
  const now = useNow(1000);
  const query = useQuery({
    queryKey: ["deployment", id],
    queryFn: () =>
      api(`deployments/${encodeURIComponent(id)}`, deploymentDetailSchema),
    refetchInterval: (q) =>
      q.state.data &&
      (q.state.data.status === "deploying" || q.state.data.status === "queued")
        ? 1200
        : false,
  });
  const cancel = useMutation({
    mutationFn: () =>
      api(`deployments/${encodeURIComponent(id)}/cancel`, okSchema, {}),
    onSuccess: () => {
      toast.success("Cancellation requested");
      void query.refetch();
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const summary = data.deployments.find((d) => d.id === id);
  const detail = query.data;
  const resource =
    data.resources.find((r) => r.id === summary?.resourceId) ??
    data.resources.find(
      (r) => r.kind === "app" && r.name === detail?.applicationName,
    );
  if (query.isLoading) return <Loading rows={8} />;
  if (query.isError || !detail)
    return (
      <Empty
        icon="deploy"
        hue="red"
        title="Deployment unavailable"
        description={
          query.error?.message ?? "This deployment may have been pruned."
        }
        action={() => router.push("/deployments")}
        actionLabel="All deployments"
      />
    );
  const running = detail.status === "deploying" || detail.status === "queued";
  const started = Date.parse(detail.createdAt);
  const ended = detail.finishedAt ? Date.parse(detail.finishedAt) : now;
  const elapsed = Number.isFinite(started) ? (ended - started) / 1000 : NaN;
  const phase = phaseOf(detail, detail.lines);
  const hue =
    detail.status === "successful"
      ? "green"
      : detail.status === "failed"
        ? "red"
        : "deploy";
  return (
    <div className="deployment-page">
      <Link
        className="back-link"
        href={resource ? resourcePath(resource, "deployments") : "/deployments"}
      >
        <Icon name="arrowLeft" size={15} />
        {resource ? resource.name : "Deployments"}
      </Link>
      <div className={`detail-head hue-${hue}`}>
        <Tile
          icon={
            detail.status === "successful"
              ? "check"
              : detail.status === "failed"
                ? "cross"
                : "deploy"
          }
          hue={hue}
          size="xl"
        />
        <div className="detail-title">
          <span className="eyebrow">
            Deployment<span className="eyebrow-sep">/</span>
            <span className="mono">{detail.id.slice(0, 12)}</span>
          </span>
          <h1>
            {detail.message ||
              detail.applicationName ||
              summary?.name ||
              "Deployment"}
          </h1>
          <div className="detail-meta">
            <DeploymentStatus status={detail.status} />
            {resource && (
              <Link
                className="meta-chip link-chip"
                href={resourcePath(resource)}
              >
                <Icon name="apps" size={13} />
                {resource.name}
              </Link>
            )}
            {detail.commit && (
              <span className="meta-chip mono">
                <Icon name="commit" size={13} />
                {detail.commit.slice(0, 7)}
              </span>
            )}
            <span className="meta-chip">
              <Icon
                name={
                  detail.trigger === "webhook"
                    ? "branch"
                    : detail.trigger === "rollback"
                      ? "rollback"
                      : "user"
                }
                size={13}
              />
              {capitalize(detail.trigger)}
            </span>
            {detail.forceRebuild && (
              <span className="meta-chip chip-amber">
                <Icon name="bolt" size={13} />
                No cache
              </span>
            )}
            <span
              className="meta-chip mono"
              title={formatDate(detail.createdAt)}
            >
              <Icon name="clock" size={13} />
              {formatDate(detail.createdAt)}
            </span>
            {Number.isFinite(elapsed) && (
              <span className={`meta-chip mono ${running ? "chip-live" : ""}`}>
                <Icon name="history" size={13} />
                {formatDuration(elapsed)}
              </span>
            )}
          </div>
        </div>
        <div className="head-actions">
          {running ? (
            <Button
              variant="outline"
              disabled={cancel.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: "Cancel this deployment?",
                  description:
                    "The build stops and the currently running version stays live.",
                  confirmLabel: "Cancel deployment",
                  icon: "cancel",
                });
                if (ok) cancel.mutate();
              }}
            >
              <Icon name="cancel" size={16} />
              Cancel
            </Button>
          ) : (
            resource && (
              <>
                {resource.domain && (
                  <Button variant="outline" onClick={() => openApp(resource)}>
                    <Icon name="arrowUpRight" size={16} />
                    Visit
                  </Button>
                )}
                <Button onClick={() => void run(resource, "deploy")}>
                  <Icon name="deploy" size={16} />
                  Redeploy
                </Button>
              </>
            )
          )}
        </div>
      </div>
      <ol
        className={`phases ${detail.status === "failed" ? "phases-failed" : ""}`}
      >
        {phases.map((p, i) => (
          <li
            key={p.id}
            className={
              i < phase || (i === phase && detail.status === "successful")
                ? "done"
                : i === phase
                  ? running
                    ? "current"
                    : detail.status === "failed"
                      ? "failed"
                      : "done"
                  : ""
            }
          >
            <span className="phase-node">
              <Icon
                name={
                  i === phase && detail.status === "failed" ? "cross" : p.icon
                }
                size={14}
              />
            </span>
            {p.label}
          </li>
        ))}
      </ol>
      <LogConsole
        lines={detail.lines}
        live={running}
        fileName={`deployment-${detail.id}.log`}
        emptyText={
          running ? "Waiting for the first log line…" : "No logs were recorded."
        }
        status={
          <span
            className={`pill ${running ? "s-deploying" : detail.status === "failed" ? "s-failed" : "s-running"}`}
          >
            <span className="dot" />
            {running ? "Streaming" : capitalize(detail.status)}
          </span>
        }
      />
    </div>
  );
}
