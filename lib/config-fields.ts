// Editable configuration fields per resource kind. Keys are Coolify API field
// names; the server only reads and writes keys listed here.
import type { Kind } from "./schemas";

type Fields = Record<string, string | number | boolean | null>;
export type FieldDef = {
  key: string;
  label: string;
  type: "text" | "textarea" | "code" | "bool" | "number" | "select";
  section: string;
  help?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  mono?: boolean;
  wide?: boolean;
  // Coolify returns some fields under a different name than it accepts.
  readFrom?: string;
  when?: (fields: Fields) => boolean;
};
const isGit = (f: Fields) => !!f.git_repository;
const isImage = (f: Fields) =>
  !f.git_repository && !!f.docker_registry_image_name;
const builds = (f: Fields) => isGit(f) || f.build_pack === "dockerfile";
const nodeLike = (f: Fields) =>
  isGit(f) && ["nixpacks", "railpack", "static"].includes(String(f.build_pack));
export const configFields: Record<Kind, FieldDef[]> = {
  app: [
    { key: "name", label: "Name", type: "text", section: "General" },
    {
      key: "description",
      label: "Description",
      type: "text",
      section: "General",
      wide: true,
    },
    {
      key: "git_repository",
      label: "Repository",
      type: "text",
      section: "Source",
      mono: true,
      when: isGit,
      wide: true,
    },
    {
      key: "git_branch",
      label: "Branch",
      type: "text",
      section: "Source",
      mono: true,
      when: isGit,
    },
    {
      key: "docker_registry_image_name",
      label: "Image",
      type: "text",
      section: "Source",
      mono: true,
      when: isImage,
      wide: true,
    },
    {
      key: "docker_registry_image_tag",
      label: "Tag",
      type: "text",
      section: "Source",
      mono: true,
      when: isImage,
    },
    {
      key: "build_pack",
      label: "Build pack",
      type: "select",
      section: "Build",
      when: isGit,
      options: [
        { value: "nixpacks", label: "Nixpacks" },
        { value: "railpack", label: "Railpack" },
        { value: "static", label: "Static" },
        { value: "dockerfile", label: "Dockerfile" },
        { value: "dockercompose", label: "Docker Compose" },
      ],
    },
    {
      key: "base_directory",
      label: "Base directory",
      type: "text",
      section: "Build",
      mono: true,
      when: isGit,
      placeholder: "/",
    },
    {
      key: "publish_directory",
      label: "Publish directory",
      type: "text",
      section: "Build",
      mono: true,
      when: nodeLike,
      placeholder: "/dist",
    },
    {
      key: "install_command",
      label: "Install command",
      type: "text",
      section: "Build",
      mono: true,
      when: nodeLike,
      wide: true,
    },
    {
      key: "build_command",
      label: "Build command",
      type: "text",
      section: "Build",
      mono: true,
      when: nodeLike,
      wide: true,
    },
    {
      key: "start_command",
      label: "Start command",
      type: "text",
      section: "Build",
      mono: true,
      when: nodeLike,
      wide: true,
    },
    {
      key: "dockerfile_location",
      label: "Dockerfile location",
      type: "text",
      section: "Build",
      mono: true,
      when: (f) => isGit(f) && f.build_pack === "dockerfile",
    },
    {
      key: "docker_compose_location",
      label: "Compose file",
      type: "text",
      section: "Build",
      mono: true,
      when: (f) => isGit(f) && f.build_pack === "dockercompose",
    },
    {
      key: "watch_paths",
      label: "Watch paths",
      type: "textarea",
      section: "Build",
      mono: true,
      when: isGit,
      help: "Only redeploy when these paths change. One glob per line.",
      wide: true,
    },
    {
      key: "is_static",
      label: "Static site",
      type: "bool",
      section: "Build",
      when: nodeLike,
      help: "Serve the build output with a web server.",
    },
    {
      key: "ports_exposes",
      label: "Exposed ports",
      type: "text",
      section: "Network",
      mono: true,
      placeholder: "3000",
    },
    {
      key: "ports_mappings",
      label: "Port mappings",
      type: "text",
      section: "Network",
      mono: true,
      placeholder: "8080:80",
      help: "Host:container. Bypasses the proxy.",
    },
    {
      key: "health_check_enabled",
      label: "Health check",
      type: "bool",
      section: "Health check",
    },
    {
      key: "health_check_path",
      label: "Path",
      type: "text",
      section: "Health check",
      mono: true,
      when: (f) => !!f.health_check_enabled,
    },
    {
      key: "health_check_port",
      label: "Port",
      type: "text",
      section: "Health check",
      mono: true,
      when: (f) => !!f.health_check_enabled,
    },
    {
      key: "health_check_return_code",
      label: "Expected status",
      type: "number",
      section: "Health check",
      when: (f) => !!f.health_check_enabled,
    },
    {
      key: "health_check_interval",
      label: "Interval (s)",
      type: "number",
      section: "Health check",
      when: (f) => !!f.health_check_enabled,
    },
    {
      key: "health_check_timeout",
      label: "Timeout (s)",
      type: "number",
      section: "Health check",
      when: (f) => !!f.health_check_enabled,
    },
    {
      key: "health_check_retries",
      label: "Retries",
      type: "number",
      section: "Health check",
      when: (f) => !!f.health_check_enabled,
    },
    {
      key: "limits_memory",
      label: "Memory limit",
      type: "text",
      section: "Resources",
      mono: true,
      placeholder: "0",
      help: "e.g. 512m or 2g. 0 means unlimited.",
    },
    {
      key: "limits_cpus",
      label: "CPU limit",
      type: "text",
      section: "Resources",
      mono: true,
      placeholder: "0",
      help: "Number of CPUs. 0 means unlimited.",
    },
    {
      key: "is_auto_deploy_enabled",
      label: "Auto deploy",
      type: "bool",
      section: "Deploy",
      when: builds,
      help: "Deploy when the branch receives a push.",
    },
    {
      key: "is_preview_deployments_enabled",
      label: "Preview deployments",
      type: "bool",
      section: "Deploy",
      when: isGit,
      help: "Deploy pull requests to their own URL.",
    },
    {
      key: "pre_deployment_command",
      label: "Pre-deployment command",
      type: "text",
      section: "Deploy",
      mono: true,
      wide: true,
    },
    {
      key: "post_deployment_command",
      label: "Post-deployment command",
      type: "text",
      section: "Deploy",
      mono: true,
      wide: true,
    },
    {
      key: "custom_docker_run_options",
      label: "Docker run options",
      type: "text",
      section: "Deploy",
      mono: true,
      wide: true,
      placeholder: "--cap-add SYS_ADMIN",
    },
  ],
  database: [
    { key: "name", label: "Name", type: "text", section: "General" },
    {
      key: "description",
      label: "Description",
      type: "text",
      section: "General",
      wide: true,
    },
    {
      key: "image",
      label: "Image",
      type: "text",
      section: "General",
      mono: true,
      help: "Changing the image restarts the database.",
    },
    {
      key: "is_public",
      label: "Publicly accessible",
      type: "bool",
      section: "Network",
      help: "Expose the database port on the server.",
    },
    {
      key: "public_port",
      label: "Public port",
      type: "number",
      section: "Network",
      when: (f) => !!f.is_public,
    },
    {
      key: "limits_memory",
      label: "Memory limit",
      type: "text",
      section: "Resources",
      mono: true,
      placeholder: "0",
    },
    {
      key: "limits_cpus",
      label: "CPU limit",
      type: "text",
      section: "Resources",
      mono: true,
      placeholder: "0",
    },
  ],
  service: [
    { key: "name", label: "Name", type: "text", section: "General" },
    {
      key: "description",
      label: "Description",
      type: "text",
      section: "General",
      wide: true,
    },
    {
      key: "connect_to_docker_network",
      label: "Connect to predefined network",
      type: "bool",
      section: "General",
      help: "Lets other resources reach this service by name.",
    },
    {
      key: "docker_compose_raw",
      label: "docker-compose.yml",
      type: "code",
      section: "Compose",
      wide: true,
    },
  ],
};
export function editableKeys(kind: Kind) {
  return new Map(configFields[kind].map((f) => [f.key, f]));
}
