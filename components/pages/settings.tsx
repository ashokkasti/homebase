"use client";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import { PageHead } from "../kit";
import { Connection } from "../connection";
import { AppearanceSettings } from "../appearance-settings";
import { okSchema, useMeta, useWorkspace } from "../workspace";

export async function signOut() {
  await api("auth/logout", okSchema, {});
  window.location.assign("/login");
}

export function SettingsPage({ onShortcuts }: { onShortcuts: () => void }) {
  const { data, openCoolify, invalidate } = useWorkspace();
  const meta = useMeta(data.connected || data.demo);
  return (
    <>
      <PageHead
        icon="settings"
        hue="neutral"
        title="Settings"
        description="Make yourself at home."
      />
      <div className="settings">
        <section className="setting-group">
          <div className="setting-intro">
            <h2>Connection</h2>
            <p>How Homebase talks to Coolify.</p>
          </div>
          <div className="setting-card">
            <div className="setting-row">
              <span>Coolify URL</span>
              <strong className="mono">
                {data.coolifyUrl || "Not connected"}
              </strong>
            </div>
            <div className="setting-row">
              <span>Coolify version</span>
              <strong className="mono">{meta.data?.version || "—"}</strong>
            </div>
            <div className="setting-row">
              <span>API connection</span>
              <span
                className={`pill ${data.connected ? "s-running" : data.demo ? "s-deploying" : "s-unknown"}`}
              >
                <span className="dot" />
                {data.demo
                  ? "Demo workspace"
                  : data.connected
                    ? "Connected"
                    : "Not connected"}
              </span>
            </div>
            <div className="setting-row">
              <span>Projects · servers</span>
              <span className="setting-links">
                <Link className="text-link" href="/projects">
                  {meta.data?.projects.length ?? "—"} projects
                </Link>
                <Link className="text-link" href="/servers">
                  {data.servers.length} servers
                </Link>
              </span>
            </div>
            {data.demo ? (
              <div className="banner">
                <Icon name="info" size={18} />
                <span>
                  You’re exploring a demo workspace. Every change stays in
                  memory. To connect your server, configure administrator
                  credentials and set <code>HOMEBASE_DEMO=false</code>.
                </span>
              </div>
            ) : (
              <Connection compact onConnected={invalidate} />
            )}
          </div>
        </section>
        <section className="setting-group" id="appearance">
          <div className="setting-intro">
            <h2>Appearance</h2>
            <p>Make Homebase yours: color, type, density and more.</p>
          </div>
          <div className="setting-card">
            <AppearanceSettings />
          </div>
        </section>
        <section className="setting-group">
          <div className="setting-intro">
            <h2>Security</h2>
            <p>Credentials never leave the server.</p>
          </div>
          <div className="setting-card">
            <div className="setting-row">
              <span>Session</span>
              <strong>{data.demo ? "Demo access" : "Administrator"}</strong>
            </div>
            <div className="setting-row">
              <span>API credentials</span>
              <span className="pill s-running">
                <Icon name="lock" size={13} />
                Stored on the server
              </span>
            </div>
            {!data.demo && (
              <div className="setting-row">
                <span>Sign out of this device</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void signOut()}
                >
                  <Icon name="logout" size={15} />
                  Sign out
                </Button>
              </div>
            )}
          </div>
        </section>
        <section className="setting-group">
          <div className="setting-intro">
            <h2>Advanced</h2>
            <p>Power tools and the full control panel.</p>
          </div>
          <div className="setting-card">
            <div className="setting-row">
              <span>Keyboard shortcuts</span>
              <Button variant="outline" size="sm" onClick={onShortcuts}>
                <Icon name="keyboard" size={15} />
                View all
              </Button>
            </div>
            <div className="setting-row">
              <span>Coolify dashboard</span>
              <Button variant="outline" size="sm" onClick={() => openCoolify()}>
                Open Coolify
                <Icon name="arrowUpRight" size={15} />
              </Button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
