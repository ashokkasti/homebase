"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { rollbackListSchema, type Resource } from "@/lib/schemas";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import { Loading, SectionHeading, formatDate } from "../kit";
import { DeploymentRows } from "../rows";
import { useConfirm } from "../confirm";
import { useWorkspace } from "../workspace";

export function DeploymentsTab({ resource }: { resource: Resource }) {
  const { data, followDeployment, invalidate } = useWorkspace();
  const confirm = useConfirm();
  const deployments = data.deployments.filter(
    (d) => d.resourceId === resource.id,
  );
  const rollback = useQuery({
    queryKey: ["rollback", resource.id],
    queryFn: () =>
      api(
        `resources/app/${encodeURIComponent(resource.id)}/rollback`,
        rollbackListSchema,
      ),
  });
  const mutation = useMutation({
    mutationFn: (tag: string) =>
      api(
        `resources/app/${encodeURIComponent(resource.id)}/rollback`,
        z.object({ ok: z.boolean(), deploymentId: z.string().optional() }),
        { tag },
      ),
    onSuccess: (result) => {
      followDeployment(result.deploymentId, resource.name);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const finished = deployments.filter(
    (d) => d.status === "successful" || d.status === "failed",
  );
  const rate = finished.length
    ? Math.round(
        (finished.filter((d) => d.status === "successful").length /
          finished.length) *
          100,
      )
    : null;
  return (
    <div className="detail-grid">
      <section className="panel">
        <SectionHeading
          title="History"
          count={deployments.length}
          action={
            rate !== null && (
              <span className="mono muted small">{rate}% success</span>
            )
          }
        />
        <DeploymentRows deployments={deployments} />
      </section>
      <aside className="panel">
        <SectionHeading title="Roll back" />
        <div className="rollback">
          {rollback.isLoading ? (
            <Loading rows={2} />
          ) : rollback.isError ? (
            <p className="muted small">{rollback.error.message}</p>
          ) : (rollback.data?.images.length ?? 0) === 0 ? (
            <p className="muted small">
              No previous images are kept on the server for this application.
            </p>
          ) : (
            rollback.data?.images.map((image) => (
              <div
                className={`rollback-row ${image.current ? "current" : ""}`}
                key={image.tag}
              >
                <span className="row-text">
                  <span className="row-title mono">
                    {image.tag.slice(0, 12)}
                  </span>
                  <span className="row-sub">
                    {image.date ? formatDate(image.date) : "Unknown date"}
                  </span>
                </span>
                {image.current ? (
                  <span className="pill s-running">
                    <span className="dot" />
                    Live
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={mutation.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Roll back to ${image.tag.slice(0, 12)}?`,
                        description:
                          "The image is redeployed without rebuilding. Environment changes since then are kept.",
                        confirmLabel: "Roll back",
                        icon: "rollback",
                        tone: "default",
                      });
                      if (ok) mutation.mutate(image.tag);
                    }}
                  >
                    <Icon name="rollback" size={15} />
                    Use
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
