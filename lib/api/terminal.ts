// /api/terminal: open a container shell (POST /terminal), stream its output
// (GET /terminal/:id, Server-Sent Events) and send input (POST /terminal/:id).
import { z } from "zod";
import { getContainers } from "../coolify/containers";
import { getDashboard } from "../coolify/dashboard";
import { demoContainers } from "../demo-store";
import { isDemo } from "../demo";
import { terminalInputSchema, terminalOpenSchema } from "../schemas";
import {
  closeTerminal,
  openContainerTerminal,
  openDemoTerminal,
  resizeTerminal,
  subscribeTerminal,
  writeTerminal,
  type TerminalEvent,
} from "../terminal";

const sessionId = z.string().regex(/^[a-f0-9]{32}$/, "Invalid terminal.");

export async function openTerminal(body: unknown) {
  const input = terminalOpenSchema.parse(body);
  const size = { cols: input.cols, rows: input.rows };
  if (isDemo()) {
    const container = demoContainers(input.kind, input.resourceId).find(
      (c) => c.name === input.container,
    );
    if (!container) throw new Error("Container not found.");
    return { id: openDemoTerminal(container.name) };
  }
  const resource = (await getDashboard()).resources.find(
    (r) => r.id === input.resourceId && r.kind === input.kind,
  );
  if (!resource) throw new Error("Resource not found.");
  // Only containers that belong to this resource can be opened.
  const { containers } = await getContainers(resource);
  const container = containers.find((c) => c.name === input.container);
  if (!container) throw new Error("Container not found.");
  if (!container.running)
    throw new Error("Start the container before opening a terminal.");
  return {
    id: await openContainerTerminal(container.serverId, container.name, size),
  };
}

export function terminalInput(id: string, body: unknown) {
  const session = sessionId.parse(id);
  const input = terminalInputSchema.parse(body);
  if (input.op === "input") writeTerminal(session, input.data);
  else if (input.op === "resize")
    resizeTerminal(session, input.cols, input.rows);
  else closeTerminal(session);
  return { ok: true };
}

export function terminalStream(id: string, request: Request) {
  const session = sessionId.parse(id);
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const write = (chunk: string) => {
        if (open) controller.enqueue(encoder.encode(chunk));
      };
      const send = (event: TerminalEvent) => {
        if (event.type === "data")
          write(`data: ${JSON.stringify(event.data)}\n\n`);
        else {
          write("event: exit\ndata: {}\n\n");
          cleanup();
        }
      };
      const heartbeat = setInterval(() => write(": ping\n\n"), 15000);
      let unsubscribe: (() => void) | null = null;
      cleanup = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // Stream already closed by the client.
        }
      };
      request.signal.addEventListener("abort", () => cleanup());
      unsubscribe = subscribeTerminal(session, send);
      if (!unsubscribe) send({ type: "exit" });
      // The replay may already have ended the stream.
      else if (!open) unsubscribe();
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform keeps compression from buffering the stream.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
