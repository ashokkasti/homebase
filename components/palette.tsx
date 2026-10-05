"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "./ui/dialog";
import { Icon, type IconName } from "./ui/icon";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import {
  Kbd,
  Keys,
  kindLabel,
  ResourceTile,
  resourcePath,
  Tile,
  timeAgo,
  type Hue,
} from "./kit";
import { useWorkspace } from "./workspace";
import { navigation } from "./navigation";

export function Palette({
  open,
  onOpenChange,
  onShortcuts,
  onToggleTheme,
  onToggleSidebar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShortcuts: () => void;
  onToggleTheme: () => void;
  onToggleSidebar: () => void;
}) {
  const router = useRouter();
  const { data, run, openApp, openCoolify } = useWorkspace();
  const [search, setSearch] = useState("");
  function go(action: () => void) {
    onOpenChange(false);
    setSearch("");
    action();
  }
  const Item = ({
    value,
    icon,
    hue,
    label,
    hint,
    onSelect,
  }: {
    value: string;
    icon: IconName;
    hue: Hue;
    label: React.ReactNode;
    hint?: React.ReactNode;
    onSelect: () => void;
  }) => (
    <CommandItem key={value} value={value} onSelect={() => go(onSelect)}>
      <Tile icon={icon} hue={hue} size="sm" />
      <span className="palette-label">{label}</span>
      {hint}
    </CommandItem>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setSearch("");
      }}
      title="Command palette"
      description="Find resources or run a command."
      wide
      bare
    >
      <Command className="palette" loop>
        <div className="palette-search">
          <Icon name="search" size={19} />
          <CommandInput
            autoFocus
            placeholder="Search resources, run actions, jump anywhere…"
            value={search}
            onValueChange={setSearch}
          />
          <Kbd>esc</Kbd>
        </div>
        <CommandList className="palette-list">
          <CommandEmpty className="palette-empty">
            <Icon name="search" size={22} />
            No results for “{search}”
          </CommandEmpty>
          <CommandGroup heading="Create">
            {Item({
              value: "New application create app",
              icon: "apps",
              hue: "app",
              label: "New application",
              hint: <Keys keys={["C"]} />,
              onSelect: () => router.push("/new/app"),
            })}
            {Item({
              value: "New database create postgres mysql redis",
              icon: "database",
              hue: "database",
              label: "New database",
              onSelect: () => router.push("/new/database"),
            })}
            {Item({
              value: "New service one-click template create",
              icon: "service",
              hue: "service",
              label: "New one-click service",
              onSelect: () => router.push("/new/service"),
            })}
            {Item({
              value: "New project create",
              icon: "project",
              hue: "project",
              label: "New project",
              onSelect: () => router.push("/projects"),
            })}
          </CommandGroup>
          <CommandGroup heading="Jump to">
            {navigation.map((n) =>
              Item({
                value: `Go to ${n.label}`,
                icon: n.icon,
                hue: n.hue,
                label: n.label,
                hint: <Keys keys={["G", n.key.toUpperCase()]} />,
                onSelect: () => router.push(n.href),
              }),
            )}
            {Item({
              value: "Go to Settings",
              icon: "settings",
              hue: "neutral",
              label: "Settings",
              hint: <Keys keys={["G", ","]} />,
              onSelect: () => router.push("/settings"),
            })}
          </CommandGroup>
          <CommandGroup heading="Resources">
            {data.resources.map((r) => (
              <CommandItem
                key={r.id}
                value={`View ${r.name} ${r.kind} ${r.domain} ${r.projectName}`}
                onSelect={() => go(() => router.push(resourcePath(r)))}
              >
                <ResourceTile resource={r} size="sm" />
                <span className="palette-label">
                  {r.name}
                  <small>
                    {kindLabel(r.kind)}
                    {r.projectName ? ` · ${r.projectName}` : ""}
                  </small>
                </span>
                <span className={`status-dot s-${r.status}`} />
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Actions">
            {data.resources.flatMap((r) => {
              const items = [
                r.kind !== "database" &&
                  Item({
                    value: `Deploy ${r.name}`,
                    icon: "deploy",
                    hue: "deploy",
                    label: (
                      <>
                        Deploy <b>{r.name}</b>
                      </>
                    ),
                    onSelect: () => void run(r, "deploy"),
                  }),
                r.kind === "app" &&
                  Item({
                    value: `Force rebuild ${r.name}`,
                    icon: "bolt",
                    hue: "amber",
                    label: (
                      <>
                        Force rebuild <b>{r.name}</b>
                      </>
                    ),
                    onSelect: () => void run(r, "force-deploy"),
                  }),
                Item({
                  value: `Logs ${r.name} tail`,
                  icon: "logs",
                  hue: "accent",
                  label: (
                    <>
                      Logs · <b>{r.name}</b>
                    </>
                  ),
                  onSelect: () => router.push(resourcePath(r, "logs")),
                }),
                Item({
                  value: `Environment variables ${r.name} env`,
                  icon: "key",
                  hue: "accent",
                  label: (
                    <>
                      Environment · <b>{r.name}</b>
                    </>
                  ),
                  onSelect: () => router.push(resourcePath(r, "environment")),
                }),
                Item({
                  value: `Configure ${r.name} settings`,
                  icon: "tuning",
                  hue: "neutral",
                  label: (
                    <>
                      Configure <b>{r.name}</b>
                    </>
                  ),
                  onSelect: () => router.push(resourcePath(r, "configuration")),
                }),
                Item({
                  value: `Restart ${r.name}`,
                  icon: "restart",
                  hue: "amber",
                  label: (
                    <>
                      Restart <b>{r.name}</b>
                    </>
                  ),
                  onSelect: () => void run(r, "restart"),
                }),
                r.status === "stopped"
                  ? Item({
                      value: `Start ${r.name}`,
                      icon: "play",
                      hue: "green",
                      label: (
                        <>
                          Start <b>{r.name}</b>
                        </>
                      ),
                      onSelect: () => void run(r, "start"),
                    })
                  : Item({
                      value: `Stop ${r.name}`,
                      icon: "stop",
                      hue: "red",
                      label: (
                        <>
                          Stop <b>{r.name}</b>
                        </>
                      ),
                      onSelect: () => void run(r, "stop"),
                    }),
                r.domain &&
                  Item({
                    value: `Open ${r.name} visit`,
                    icon: "arrowUpRight",
                    hue: "neutral",
                    label: (
                      <>
                        Open <b>{r.name}</b>
                      </>
                    ),
                    onSelect: () => openApp(r),
                  }),
              ];
              return items.filter(Boolean);
            })}
          </CommandGroup>
          {data.deployments.length > 0 && (
            <CommandGroup heading="Recent deployments">
              {data.deployments.slice(0, 6).map((d) =>
                Item({
                  value: `Deployment ${d.name} ${d.commit} ${d.message} ${d.id}`,
                  icon:
                    d.status === "failed"
                      ? "cross"
                      : d.status === "successful"
                        ? "check"
                        : "deploy",
                  hue:
                    d.status === "failed"
                      ? "red"
                      : d.status === "successful"
                        ? "green"
                        : "deploy",
                  label: (
                    <>
                      {d.name}
                      <small>
                        {d.message || d.commit} · {timeAgo(d.date)}
                      </small>
                    </>
                  ),
                  onSelect: () =>
                    router.push(`/deployments/${encodeURIComponent(d.id)}`),
                }),
              )}
            </CommandGroup>
          )}
          <CommandGroup heading="Preferences">
            {Item({
              value: "Toggle theme dark light mode",
              icon: "palette",
              hue: "accent",
              label: "Toggle theme",
              hint: <Kbd>T</Kbd>,
              onSelect: onToggleTheme,
            })}
            {Item({
              value: "Appearance customize accent color font density theme",
              icon: "palette",
              hue: "accent",
              label: "Appearance settings",
              onSelect: () => router.push("/settings#appearance"),
            })}
            {Item({
              value: "Toggle sidebar collapse compact icon rail",
              icon: "list",
              hue: "neutral",
              label: "Collapse / expand sidebar",
              hint: <Kbd>\</Kbd>,
              onSelect: onToggleSidebar,
            })}
            {Item({
              value: "Keyboard shortcuts help",
              icon: "keyboard",
              hue: "neutral",
              label: "Keyboard shortcuts",
              hint: <Kbd>?</Kbd>,
              onSelect: onShortcuts,
            })}
            {Item({
              value: "Open Coolify dashboard",
              icon: "external",
              hue: "neutral",
              label: "Open Coolify",
              onSelect: () => openCoolify(),
            })}
          </CommandGroup>
        </CommandList>
        <div className="palette-foot">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            navigate
          </span>
          <span>
            <Kbd>↵</Kbd>
            select
          </span>
          <span className="palette-brand">
            <Icon name="home" size={14} />
            homebase
          </span>
        </div>
      </Command>
    </Dialog>
  );
}
