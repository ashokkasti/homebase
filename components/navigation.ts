import type { IconName } from "./ui/icon";
import type { Hue } from "./kit";

export type NavItem = {
  label: string;
  href: string;
  icon: IconName;
  hue: Hue;
  key: string;
  group: "Workspace" | "Activity" | "Infrastructure";
};
export const navigation: NavItem[] = [
  {
    label: "Overview",
    href: "/",
    icon: "overview",
    hue: "accent",
    key: "o",
    group: "Workspace",
  },
  {
    label: "Projects",
    href: "/projects",
    icon: "project",
    hue: "project",
    key: "j",
    group: "Workspace",
  },
  {
    label: "Apps",
    href: "/apps",
    icon: "apps",
    hue: "app",
    key: "a",
    group: "Workspace",
  },
  {
    label: "Databases",
    href: "/databases",
    icon: "database",
    hue: "database",
    key: "d",
    group: "Workspace",
  },
  {
    label: "Services",
    href: "/services",
    icon: "service",
    hue: "service",
    key: "s",
    group: "Workspace",
  },
  {
    label: "Deployments",
    href: "/deployments",
    icon: "deploy",
    hue: "deploy",
    key: "p",
    group: "Activity",
  },
  {
    label: "Backups",
    href: "/backups",
    icon: "backup",
    hue: "backup",
    key: "b",
    group: "Activity",
  },
  {
    label: "Servers",
    href: "/servers",
    icon: "server",
    hue: "server",
    key: "v",
    group: "Infrastructure",
  },
];
export const navGroups = ["Workspace", "Activity", "Infrastructure"] as const;
export const shortcuts: { keys: string[]; label: string; group: string }[] = [
  { keys: ["⌘", "K"], label: "Command palette", group: "General" },
  { keys: ["C"], label: "Create a new resource", group: "General" },
  { keys: ["R"], label: "Refresh data", group: "General" },
  { keys: ["T"], label: "Toggle theme", group: "General" },
  { keys: ["\\"], label: "Collapse or expand sidebar", group: "General" },
  { keys: ["/"], label: "Search on the current page", group: "General" },
  { keys: ["?"], label: "Show this list", group: "General" },
  ...navigation.map((n) => ({
    keys: ["G", n.key.toUpperCase()],
    label: n.label,
    group: "Navigate",
  })),
  { keys: ["G", ","], label: "Settings", group: "Navigate" },
  { keys: ["1–8"], label: "Switch resource tab", group: "Resource" },
  { keys: ["⌘", "S"], label: "Save configuration or .env", group: "Resource" },
  { keys: ["↵"], label: "Next log match (⇧↵ previous)", group: "Logs" },
];
