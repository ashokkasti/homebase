"use client";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";

export function Connection({
  onConnected,
  compact = false,
}: {
  onConnected: () => void;
  compact?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [tested, setTested] = useState(false);
  const [count, setCount] = useState(0);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function connect(save: boolean) {
    setPending(true);
    setError("");
    try {
      const result = await api(
        "connection",
        z.object({ ok: z.boolean(), count: z.number() }),
        { url, token, save },
      );
      if (save) {
        setToken("");
        toast.success("Connected to Coolify");
        onConnected();
      } else {
        setTested(true);
        setCount(result.count);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed.");
      setTested(false);
    } finally {
      setPending(false);
    }
  }
  const steps = ["Coolify URL", "API token", "Test & save"];
  const step = tested ? 2 : url ? 1 : 0;
  return (
    <div className={`connection ${compact ? "connection-compact" : ""}`}>
      {!compact && (
        <>
          <span className="brand-mark brand-mark-lg">
            <Icon name="home" size={30} />
          </span>
          <h1>Welcome to Homebase</h1>
          <p>Connect your Coolify server to get started.</p>
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={s} className={i <= step ? "done" : ""}>
                <span className="mono">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </>
      )}
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void connect(tested);
        }}
      >
        <label className="field">
          <span>Coolify URL</span>
          <span className="input-icon">
            <Icon name="globe" size={16} />
            <input
              type="url"
              className="mono"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setTested(false);
              }}
              placeholder="https://coolify.example.com"
              required
            />
          </span>
        </label>
        <label className="field">
          <span>API token</span>
          <span className="input-icon">
            <Icon name="key" size={16} />
            <input
              type="password"
              className="mono"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setTested(false);
              }}
              placeholder="Your Coolify API token"
              required
              autoComplete="off"
            />
          </span>
        </label>
        {error && (
          <div role="alert" className="banner banner-red">
            <Icon name="danger" size={18} />
            <span>{error}</span>
          </div>
        )}
        {tested && (
          <div className="banner banner-green">
            <Icon name="check" size={18} />
            <span>
              Connected to Coolify · <b className="mono">{count}</b>{" "}
              applications found
            </span>
          </div>
        )}
        <Button type="submit" disabled={pending}>
          {pending
            ? "Connecting…"
            : tested
              ? "Save & continue"
              : "Test connection"}
          <Icon name="arrowRight" size={16} />
        </Button>
      </form>
    </div>
  );
}
