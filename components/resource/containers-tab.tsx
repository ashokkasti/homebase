"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  containerListSchema,
  type Container,
  type Resource,
} from "@/lib/schemas";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import { copyText, Empty, Loading, SectionHeading, Tile } from "../kit";
import { ContainerTerminal } from "../container-terminal";

function stateTone(c: Container) {
  if (c.running)
    return c.status.toLowerCase().includes("unhealthy")
      ? "s-failed"
      : "s-running";
  if (c.state === "restarting" || c.state === "created") return "s-deploying";
  if (c.state === "dead") return "s-failed";
  return "s-stopped";
}

export function useContainers(resource: Resource) {
  return useQuery({
    queryKey: ["containers", resource.kind, resource.id],
    queryFn: () =>
      api(
        `resources/${resource.kind}/${encodeURIComponent(resource.id)}/containers`,
        containerListSchema,
      ),
    refetchInterval: 15000,
  });
}

export function ContainersTab({ resource }: { resource: Resource }) {
  const query = useContainers(resource);
  const requested = useSearchParams().get("terminal");
  const [selected, setOpen] = useState<Container | null | undefined>();
  // ?terminal=<name> opens that container's shell straight away.
  const open =
    selected === undefined
      ? (query.data?.containers.find(
          (c) => c.name === requested && c.running,
        ) ?? null)
      : selected;
  if (query.isLoading) return <Loading rows={3} />;
  if (query.isError || !query.data)
    return (
      <Empty
        icon="container"
        hue="red"
        title="Containers unavailable"
        description={query.error?.message ?? ""}
        action={() => void query.refetch()}
        actionLabel="Try again"
        compact
      />
    );
  const { containers, warnings } = query.data;
  const running = containers.filter((c) => c.running).length;
  return (
    <div className="stack">
      {warnings.map((w) => (
        <div className="banner" key={w}>
          <Icon name="info" size={18} />
          <span>{w}</span>
        </div>
      ))}
      <section className="panel">
        <SectionHeading
          title="Containers"
          count={containers.length}
          action={
            <span className="muted container-summary">
              {running} running
              <button
                className="icon-button"
                aria-label="Refresh containers"
                title="Refresh"
                onClick={() => void query.refetch()}
              >
                <Icon
                  name="refresh"
                  size={15}
                  className={query.isFetching ? "spin" : ""}
                />
              </button>
            </span>
          }
        />
        {containers.length === 0 ? (
          <Empty
            icon="container"
            hue="neutral"
            title="No containers"
            description="Nothing is running for this resource yet. Deploy or start it first."
            compact
          />
        ) : (
          <div className="rows rows-compact">
            {containers.map((c) => (
              <div
                className={`row container-row ${open?.name === c.name ? "active" : ""}`}
                key={`${c.serverId}/${c.id}`}
              >
                <span className="row-main">
                  <Tile
                    icon="container"
                    hue={c.running ? "green" : "neutral"}
                    size="sm"
                  />
                  <span className="row-text">
                    <span className="row-title mono">
                      {c.name}
                      <button
                        className="icon-button inline-copy"
                        aria-label={`Copy ${c.name}`}
                        title="Copy name"
                        onClick={() =>
                          void copyText(c.name, "Container name copied")
                        }
                      >
                        <Icon name="copy" size={13} />
                      </button>
                    </span>
                    <span className="row-sub mono">
                      {c.component && <b>{c.component} · </b>}
                      {c.image}
                      <span className="muted">
                        {" "}
                        · {c.id} · {c.serverName}
                      </span>
                    </span>
                  </span>
                </span>
                <span className={`pill ${stateTone(c)}`} title={c.status}>
                  <span className="dot" />
                  {c.status || c.state}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!c.running}
                  title={
                    c.running
                      ? `Open a shell in ${c.name}`
                      : "Start the container to open a terminal"
                  }
                  onClick={() => setOpen(c)}
                >
                  <Icon name="terminal" size={15} />
                  Terminal
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
      {open && (
        <ContainerTerminal
          key={open.name}
          kind={resource.kind}
          resourceId={resource.id}
          container={open}
          onClose={() => setOpen(null)}
        />
      )}
      {open && (
        <p className="list-foot">
          <Icon name="shieldWarning" size={15} />
          Commands run inside the container with its own user. Changes not in a
          volume are lost on the next deploy.
        </p>
      )}
    </div>
  );
}
