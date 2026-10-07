"use client";
// Interactive shell inside a container. Output arrives over Server-Sent Events,
// keystrokes are posted back in small batches.
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { z } from "zod";
import { api } from "@/lib/api";
import type { Container, Kind } from "@/lib/schemas";
import { okSchema } from "./workspace";
import { Icon } from "./ui/icon";

type State = "connecting" | "open" | "closed" | "error";
const stateCopy: Record<State, { label: string; tone: string }> = {
  connecting: { label: "Connecting", tone: "s-deploying" },
  open: { label: "Connected", tone: "s-running" },
  closed: { label: "Disconnected", tone: "s-unknown" },
  error: { label: "Failed", tone: "s-failed" },
};

function themeFrom(element: HTMLElement) {
  const css = getComputedStyle(element);
  const v = (name: string) => css.getPropertyValue(name).trim() || undefined;
  return {
    background: v("--term-bg"),
    foreground: v("--term-fg"),
    cursor: v("--term-fg"),
    selectionBackground: v("--term-dim"),
    red: v("--term-err"),
    green: v("--term-ok"),
    yellow: v("--term-warn"),
    magenta: v("--term-stderr"),
    brightBlack: v("--term-muted"),
  };
}

export function ContainerTerminal({
  kind,
  resourceId,
  container,
  onClose,
}: {
  kind: Kind;
  resourceId: string;
  container: Container;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>("connecting");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let session = "";
    let source: EventSource | undefined;
    let pending = "";
    let flushing = false;
    const cleanups: (() => void)[] = [];
    const send = (body: unknown) =>
      api(`terminal/${session}`, okSchema, body).catch(() => undefined);
    async function flush() {
      if (flushing || !pending || !session) return;
      flushing = true;
      while (pending) {
        const data = pending;
        pending = "";
        await send({ op: "input", data });
      }
      flushing = false;
    }
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed) return;
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: getComputedStyle(element).fontFamily,
        theme: themeFrom(element),
        scrollback: 5000,
        allowProposedApi: false,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(element);
      fit.fit();
      term.focus();
      cleanups.push(() => term.dispose());
      try {
        const opened = await api("terminal", z.object({ id: z.string() }), {
          kind,
          resourceId,
          container: container.name,
          cols: term.cols,
          rows: term.rows,
        });
        session = opened.id;
      } catch (e) {
        if (disposed) return;
        setState("error");
        setError(e instanceof Error ? e.message : "Could not open terminal.");
        return;
      }
      if (disposed) {
        void send({ op: "close" });
        return;
      }
      source = new EventSource(`/api/terminal/${session}`);
      source.onopen = () => setState("open");
      source.onmessage = (event) => {
        try {
          term.write(JSON.parse(event.data as string) as string);
        } catch {
          // Ignore malformed frames.
        }
      };
      source.addEventListener("exit", () => {
        source?.close();
        setState("closed");
        term.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n");
      });
      source.onerror = () => {
        if (source?.readyState === EventSource.CLOSED) setState("closed");
      };
      const input = term.onData((data) => {
        pending += data;
        void flush();
      });
      const resize = term.onResize(
        ({ cols, rows }) => void send({ op: "resize", cols, rows }),
      );
      const observer = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          // Element hidden.
        }
      });
      observer.observe(element);
      cleanups.push(
        () => input.dispose(),
        () => resize.dispose(),
        () => observer.disconnect(),
      );
    })();
    return () => {
      disposed = true;
      source?.close();
      if (session) void send({ op: "close" });
      for (const cleanup of cleanups.reverse()) cleanup();
    };
  }, [kind, resourceId, container.name, attempt]);
  const s = stateCopy[state];
  return (
    <div className="console terminal-console">
      <div className="console-bar">
        <span className={`pill ${s.tone}`}>
          <span className="dot" />
          {s.label}
        </span>
        <span className="terminal-title mono">
          <Icon name="terminal" size={14} />
          {container.name}
          <span className="muted">· {container.serverName}</span>
        </span>
        <span className="console-spacer" />
        {(state === "closed" || state === "error") && (
          <button
            className="button button-ghost button-sm"
            onClick={() => {
              setError("");
              setState("connecting");
              setAttempt((n) => n + 1);
            }}
          >
            <Icon name="refresh" size={14} />
            Reconnect
          </button>
        )}
        <button
          className="icon-button"
          aria-label="Close terminal"
          title="Close terminal"
          onClick={onClose}
        >
          <Icon name="cross" size={16} />
        </button>
      </div>
      {error && (
        <div className="terminal-error">
          <Icon name="danger" size={16} />
          {error}
        </div>
      )}
      <div className="terminal-host mono" ref={host} key={attempt} />
    </div>
  );
}
