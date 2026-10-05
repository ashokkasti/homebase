"use client";
// Workspace state shared by every page: dashboard data plus resource actions.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  actionSchema,
  dashboardSchema,
  metaSchema,
  type Dashboard,
  type Resource,
} from "@/lib/schemas";
import { useConfirm } from "./confirm";
import { capitalize, kindSection, resourcePath } from "./kit";

export type Action = z.infer<typeof actionSchema>["action"];
export type Component = Resource["components"][number];
const actionResult = z.object({
  ok: z.boolean(),
  deploymentId: z.string().optional(),
});
export const okSchema = z.object({ ok: z.boolean() }).passthrough();

type Workspace = {
  query: UseQueryResult<Dashboard>;
  data: Dashboard;
  run: (resource: Resource, action: Action) => Promise<void>;
  runComponent: (
    resource: Resource,
    component: Component,
    action: "start" | "restart" | "stop",
  ) => Promise<void>;
  busy: boolean;
  openCoolify: (url?: string) => void;
  openApp: (resource: Resource) => void;
  followDeployment: (deploymentId: string | undefined, name: string) => void;
  invalidate: () => void;
};
const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Workspace context is missing.");
  return value;
}
export function useMeta(enabled = true) {
  return useQuery({
    queryKey: ["meta"],
    queryFn: () => api("meta", metaSchema),
    staleTime: 60000,
    enabled,
  });
}
export function useDashboardQuery() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api("dashboard", dashboardSchema),
    refetchInterval: (q) =>
      q.state.data?.deployments.some(
        (d) => d.status === "deploying" || d.status === "queued",
      )
        ? 2500
        : 20000,
  });
}
export function WorkspaceProvider({
  query,
  children,
}: {
  query: UseQueryResult<Dashboard>;
  children: ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const data = query.data as Dashboard;
  const pending = useRef(new Map<string, number>());
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };
  useEffect(() => {
    if (!data) return;
    for (const [id, started] of pending.current) {
      const deployment = data.deployments.find(
        (d) => d.resourceId === id && Date.parse(d.date) >= started,
      );
      if (
        deployment?.status === "successful" ||
        deployment?.status === "failed"
      ) {
        const open = {
          label: "View logs",
          onClick: () =>
            router.push(`/deployments/${encodeURIComponent(deployment.id)}`),
        };
        if (deployment.status === "successful")
          toast.success(`${deployment.name} deployed`, { action: open });
        else
          toast.error(`${deployment.name} deployment failed`, { action: open });
        pending.current.delete(id);
      }
    }
  }, [data, router]);
  function followDeployment(deploymentId: string | undefined, name: string) {
    toast.success(`Deploying ${name}`, {
      description: "Logs stream live on the deployment page.",
      action: deploymentId
        ? {
            label: "Follow",
            onClick: () =>
              router.push(`/deployments/${encodeURIComponent(deploymentId)}`),
          }
        : undefined,
    });
  }
  const mutation = useMutation({
    mutationFn: (variables: {
      resource: Resource;
      action: Action;
      confirmation?: string;
      deleteVolumes?: boolean;
    }) =>
      api(
        `resources/${encodeURIComponent(variables.resource.id)}/action`,
        actionResult,
        {
          action: variables.action,
          confirmation: variables.confirmation,
          deleteVolumes: variables.deleteVolumes ?? false,
        },
      ),
    onSuccess: (result, { resource, action }) => {
      if (action === "deploy" || action === "force-deploy") {
        pending.current.set(resource.id, Date.now() - 1000);
        followDeployment(result.deploymentId, resource.name);
      } else if (action === "delete") {
        toast.success(`${resource.name} deleted`);
        router.push(`/${kindSection(resource.kind)}`);
      } else toast.success(`${resource.name}: ${action} requested`);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const componentMutation = useMutation({
    mutationFn: (variables: {
      resource: Resource;
      component: Component;
      action: "start" | "restart" | "stop";
    }) =>
      api("service-components/action", okSchema, {
        serviceId: variables.resource.id,
        componentId: variables.component.id,
        kind: variables.component.kind,
        action: variables.action,
        confirmation: variables.component.name,
      }),
    onSuccess: (_r, v) => {
      toast.success(`${v.component.name}: ${v.action} requested`);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  async function run(resource: Resource, action: Action) {
    if (
      action === "deploy" ||
      action === "force-deploy" ||
      action === "start"
    ) {
      mutation.mutate({ resource, action });
      return;
    }
    const result = await confirm(
      action === "delete"
        ? {
            title: `Delete ${resource.name}?`,
            description:
              "Containers, configuration and history are removed from Coolify. This cannot be undone.",
            confirmLabel: "Delete forever",
            icon: "trash",
            typeToConfirm: resource.name,
            option: {
              label: "Also delete volumes",
              description:
                "Permanently erases persistent data stored by this resource.",
            },
          }
        : {
            title: `${capitalize(action)} ${resource.name}?`,
            description:
              action === "restart"
                ? "The resource will briefly become unavailable."
                : "The resource stays unavailable until you start it again.",
            confirmLabel: capitalize(action),
            icon: action === "restart" ? "restart" : "stop",
            tone: action === "restart" ? "default" : "danger",
          },
    );
    if (!result) return;
    mutation.mutate({
      resource,
      action,
      confirmation: resource.name,
      deleteVolumes: result.option,
    });
  }
  async function runComponent(
    resource: Resource,
    component: Component,
    action: "start" | "restart" | "stop",
  ) {
    if (!component.id || !component.kind) {
      toast.error("Coolify did not provide an ID for this service component.");
      return;
    }
    if (action !== "start") {
      const ok = await confirm({
        title: `${capitalize(action)} ${component.name}?`,
        description: `Only the ${component.name} container of ${resource.name} is affected.`,
        confirmLabel: capitalize(action),
        icon: action === "restart" ? "restart" : "stop",
        tone: action === "restart" ? "default" : "danger",
      });
      if (!ok) return;
    }
    componentMutation.mutate({ resource, component, action });
  }
  function openCoolify(url?: string) {
    const destination = url || data?.coolifyUrl;
    if (destination) window.open(destination, "_blank", "noopener,noreferrer");
    else {
      router.push("/settings");
      toast.info("Connect your Coolify server to open its dashboard.");
    }
  }
  function openApp(resource: Resource) {
    if (data?.demo) {
      toast.info(
        "This is a sample application. Connect Coolify to open your own apps.",
      );
      return;
    }
    if (resource.domain)
      window.open(resource.domain, "_blank", "noopener,noreferrer");
  }
  return (
    <WorkspaceContext.Provider
      value={{
        query,
        data,
        run,
        runComponent,
        busy: mutation.isPending || componentMutation.isPending,
        openCoolify,
        openApp,
        followDeployment,
        invalidate,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
export { resourcePath };
