// Interactive container shells. The browser reads output over Server-Sent Events
// and posts keystrokes, so no WebSocket server is needed next to Next.js.
// Sessions live in memory: Homebase runs as a single process for one admin.
import { randomBytes } from "node:crypto";
import type { ClientChannel } from "ssh2";
import { sshShell } from "./coolify/ssh";

type Pty = {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
};
type Session = {
  id: string;
  pty: Pty;
  backlog: string[];
  backlogSize: number;
  listeners: Set<(event: TerminalEvent) => void>;
  exited: boolean;
  idle?: NodeJS.Timeout;
};
export type TerminalEvent = { type: "data"; data: string } | { type: "exit" };

const store = globalThis as typeof globalThis & {
  homebaseTerminals?: Map<string, Session>;
};
const sessions = (store.homebaseTerminals ??= new Map());
const MAX_SESSIONS = 12;
const BACKLOG = 128 * 1024;
const IDLE_MS = 120000;

function emit(session: Session, event: TerminalEvent) {
  if (event.type === "data") {
    session.backlog.push(event.data);
    session.backlogSize += event.data.length;
    while (session.backlogSize > BACKLOG && session.backlog.length > 1)
      session.backlogSize -= session.backlog.shift()?.length ?? 0;
  } else session.exited = true;
  for (const listener of session.listeners) listener(event);
  if (event.type === "exit") scheduleIdle(session, 10000);
}

function scheduleIdle(session: Session, ms = IDLE_MS) {
  clearTimeout(session.idle);
  session.idle = setTimeout(() => {
    if (session.listeners.size === 0 || session.exited)
      closeTerminal(session.id);
  }, ms);
}

function register(pty: Pty) {
  if (sessions.size >= MAX_SESSIONS)
    throw new Error("Too many open terminals. Close one and try again.");
  const session: Session = {
    id: randomBytes(16).toString("hex"),
    pty,
    backlog: [],
    backlogSize: 0,
    listeners: new Set(),
    exited: false,
  };
  sessions.set(session.id, session);
  scheduleIdle(session, 30000);
  return session;
}

function channelPty(stream: ClientChannel): Pty {
  return {
    write: (data) => void stream.write(data),
    resize: (cols, rows) => stream.setWindow(rows, cols, 0, 0),
    close: () => stream.close(),
  };
}

export async function openContainerTerminal(
  serverId: string,
  container: string,
  size: { cols: number; rows: number },
) {
  // container is validated against containerNameSchema and the resource's
  // own container list before reaching here, so it is safe to interpolate.
  const stream = await sshShell(
    serverId,
    (docker) =>
      `${docker} exec -it -e TERM=xterm-256color ${container} sh -c 'if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi'`,
    size,
  );
  const session = register(channelPty(stream));
  const decoder = new TextDecoder();
  const onData = (chunk: Buffer) =>
    emit(session, {
      type: "data",
      data: decoder.decode(chunk, { stream: true }),
    });
  stream.on("data", onData);
  stream.stderr.on("data", onData);
  stream.once("close", () => emit(session, { type: "exit" }));
  return session.id;
}

export function writeTerminal(id: string, data: string) {
  const session = sessions.get(id);
  if (!session || session.exited) throw new Error("This terminal has closed.");
  session.pty.write(data);
}
export function resizeTerminal(id: string, cols: number, rows: number) {
  sessions.get(id)?.pty.resize(cols, rows);
}
export function closeTerminal(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  clearTimeout(session.idle);
  try {
    session.pty.close();
  } catch {
    // Already closed.
  }
  for (const listener of session.listeners) listener({ type: "exit" });
  session.listeners.clear();
}

// Replays recent output, then follows. Returns an unsubscribe function.
export function subscribeTerminal(
  id: string,
  listener: (event: TerminalEvent) => void,
) {
  const session = sessions.get(id);
  if (!session) return null;
  clearTimeout(session.idle);
  const replay = session.backlog.join("");
  if (replay) listener({ type: "data", data: replay });
  if (session.exited) listener({ type: "exit" });
  session.listeners.add(listener);
  return () => {
    session.listeners.delete(listener);
    if (session.listeners.size === 0) scheduleIdle(session);
  };
}

// ───────────── Demo shell ─────────────
// A tiny pretend shell so the demo workspace can show the terminal.
export function openDemoTerminal(container: string) {
  let line = "";
  const prompt = `\x1b[32mroot@${container.slice(0, 12)}\x1b[0m:\x1b[34m/app\x1b[0m# `;
  const commands: Record<string, string> = {
    pwd: "/app",
    whoami: "root",
    hostname: container.slice(0, 12),
    ls: "node_modules  package.json  dist  public",
    "ls -la":
      "total 48\ndrwxr-xr-x 1 root root 4096 .\ndrwxr-xr-x 1 root root 4096 ..\ndrwxr-xr-x 1 root root 4096 dist\ndrwxr-xr-x 1 root root 4096 node_modules\n-rw-r--r-- 1 root root  812 package.json\ndrwxr-xr-x 1 root root 4096 public",
    "cat /etc/os-release": 'NAME="Alpine Linux"\nVERSION_ID=3.20.3',
    uptime: " 10:42:17 up 12 days,  3:04,  load average: 0.21, 0.18, 0.12",
    help: "Demo shell. Try: ls, pwd, whoami, uptime, env, exit",
    env: "NODE_ENV=production\nPORT=3000\nHOSTNAME=0.0.0.0",
  };
  let session: Session | undefined = undefined;
  const out = (data: string) =>
    session && emit(session, { type: "data", data });
  session = register({
    write(data) {
      for (const ch of data) {
        if (ch === "\r") {
          const cmd = line.trim();
          line = "";
          out("\r\n");
          if (cmd === "exit") {
            out("logout\r\n");
            if (session) emit(session, { type: "exit" });
            return;
          }
          if (cmd === "clear") out("\x1b[2J\x1b[H");
          else if (cmd.startsWith("echo ")) out(`${cmd.slice(5)}\r\n`);
          else if (cmd)
            out(
              `${(commands[cmd] ?? `sh: ${cmd.split(" ")[0]}: not found in the demo shell`).replaceAll("\n", "\r\n")}\r\n`,
            );
          out(prompt);
        } else if (ch === "\x7f") {
          if (line) {
            line = line.slice(0, -1);
            out("\b \b");
          }
        } else if (ch === "\x03") {
          line = "";
          out(`^C\r\n${prompt}`);
        } else if (ch >= " ") {
          line += ch;
          out(ch);
        }
      }
    },
    resize() {},
    close() {},
  });
  out(`Demo terminal for ${container}. Type \x1b[1mhelp\x1b[0m.\r\n${prompt}`);
  return session.id;
}
