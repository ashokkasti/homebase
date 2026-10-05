"use client";
// Full-height log console used by deployment pages and runtime log tabs.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/lib/api";
import type { LogLine } from "@/lib/schemas";
import { Icon } from "./ui/icon";
import { copyText, hour12, Kbd, Segmented } from "./kit";

type Level = "error" | "warn" | "ok" | "stderr" | "";
function levelOf(line: LogLine): Level {
  const t = line.text.toLowerCase();
  if (
    /\b(error|fatal|failed|exception|panic)\b|exited with code [1-9]|err!/.test(
      t,
    )
  )
    return "error";
  if (/\b(warn|warning|deprecated)\b/.test(t)) return "warn";
  if (
    /\b(success|successful|successfully|healthy|completed|ready|listening|started)\b/.test(
      t,
    )
  )
    return "ok";
  return line.stream === "stderr" ? "stderr" : "";
}
function highlight(text: string, term: string) {
  if (!term) return text || " ";
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  const parts: ReactNode[] = [];
  let index = 0;
  let found = lower.indexOf(needle);
  while (found !== -1) {
    parts.push(text.slice(index, found));
    parts.push(
      <mark key={found}>{text.slice(found, found + term.length)}</mark>,
    );
    index = found + term.length;
    found = lower.indexOf(needle, index);
  }
  parts.push(text.slice(index));
  return parts;
}
function clock(time: string) {
  const ms = Date.parse(time);
  if (!Number.isFinite(ms)) return time.slice(11, 19);
  return new Date(ms).toLocaleTimeString(undefined, { hour12: hour12() });
}

export function LogConsole({
  lines,
  live,
  loading = false,
  error,
  fileName,
  emptyText = "No log lines yet.",
  toolbar,
  status,
}: {
  lines: LogLine[];
  live: boolean;
  loading?: boolean;
  error?: string;
  fileName: string;
  emptyText?: string;
  toolbar?: ReactNode;
  status?: ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [onlyMatches, setOnlyMatches] = useState(true);
  const [level, setLevel] = useState<"all" | "error" | "warn">("all");
  const [wrap, setWrap] = useState(true);
  const [times, setTimes] = useState(true);
  const [debug, setDebug] = useState(false);
  const [follow, setFollow] = useState(true);
  const [cursor, setCursor] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasHidden = lines.some((l) => l.hidden);
  const hasTimes = lines.some((l) => l.time);
  const rows = useMemo(
    () =>
      lines
        .map((line, index) => ({ line, index, level: levelOf(line) }))
        .filter((row) => debug || !row.line.hidden),
    [lines, debug],
  );
  const counts = useMemo(
    () => ({
      error: rows.filter((r) => r.level === "error").length,
      warn: rows.filter((r) => r.level === "warn").length,
    }),
    [rows],
  );
  const term = search.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      (level === "all" || r.level === level) &&
      (!term || !onlyMatches || r.line.text.toLowerCase().includes(term)),
  );
  const matches = term
    ? visible
        .filter((r) => r.line.text.toLowerCase().includes(term))
        .map((r) => r.index)
    : [];
  useEffect(() => {
    if (follow && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visible.length, follow, lines]);
  function jump(direction: 1 | -1) {
    if (!matches.length) return;
    const next = (cursor + direction + matches.length) % matches.length;
    setCursor(next);
    setFollow(false);
    scrollRef.current
      ?.querySelector(`[data-line="${matches[next]}"]`)
      ?.scrollIntoView({ block: "center" });
  }
  const text = visible
    .map((r) => (r.line.time ? `${r.line.time} ` : "") + r.line.text)
    .join("\n");
  return (
    <div className="console">
      <div className="console-bar">
        {status}
        <label className="search-field console-search">
          <Icon name="search" size={15} />
          <input
            data-page-search=""
            placeholder="Search logs…"
            aria-label="Search logs"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                jump(e.shiftKey ? -1 : 1);
              }
              if (e.key === "Escape") {
                setSearch("");
                e.currentTarget.blur();
              }
            }}
          />
          {term ? (
            <span className="mono console-count">
              {matches.length
                ? `${Math.min(cursor + 1, matches.length)}/${matches.length}`
                : "0"}
            </span>
          ) : (
            <Kbd>/</Kbd>
          )}
        </label>
        <button
          className={`icon-button ${onlyMatches ? "toggled" : ""}`}
          title={
            onlyMatches ? "Showing matching lines only" : "Showing all lines"
          }
          aria-pressed={onlyMatches}
          aria-label="Only show matching lines"
          onClick={() => setOnlyMatches(!onlyMatches)}
        >
          <Icon name="filter" size={17} />
        </button>
        <Segmented
          value={level}
          onChange={setLevel}
          label="Level filter"
          options={[
            { value: "all", label: "All" },
            {
              value: "error",
              label: "Errors",
              count: counts.error,
              dot: "failed",
            },
            {
              value: "warn",
              label: "Warnings",
              count: counts.warn,
              dot: "warn",
            },
          ]}
        />
        <span className="console-spacer" />
        {toolbar}
        {hasTimes && (
          <button
            className={`icon-button ${times ? "toggled" : ""}`}
            title="Timestamps"
            aria-pressed={times}
            aria-label="Show timestamps"
            onClick={() => setTimes(!times)}
          >
            <Icon name="clock" size={17} />
          </button>
        )}
        <button
          className={`icon-button ${wrap ? "toggled" : ""}`}
          title="Wrap lines"
          aria-pressed={wrap}
          aria-label="Wrap lines"
          onClick={() => setWrap(!wrap)}
        >
          <Icon name="wrap" size={17} />
        </button>
        {hasHidden && (
          <button
            className={`icon-button ${debug ? "toggled" : ""}`}
            title="Show internal commands"
            aria-pressed={debug}
            aria-label="Show internal commands"
            onClick={() => setDebug(!debug)}
          >
            <Icon name="bug" size={17} />
          </button>
        )}
        <button
          className="icon-button"
          title="Copy visible lines"
          aria-label="Copy logs"
          onClick={() => void copyText(text, "Logs copied")}
        >
          <Icon name="copy" size={17} />
        </button>
        <button
          className="icon-button"
          title="Download"
          aria-label="Download logs"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([text], { type: "text/plain" }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Icon name="download" size={17} />
        </button>
      </div>
      <div
        ref={scrollRef}
        className={`terminal console-body ${wrap ? "" : "nowrap"}`}
        role="log"
        aria-live="off"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          if (atBottom !== follow) setFollow(atBottom);
        }}
      >
        {error ? (
          <div className="term-line term-error">{error}</div>
        ) : loading ? (
          <div className="term-line term-muted">Loading logs…</div>
        ) : visible.length === 0 ? (
          <div className="term-line term-muted">
            {lines.length ? "No lines match the current filters." : emptyText}
          </div>
        ) : (
          visible.map((r) => (
            <div
              key={r.index}
              data-line={r.index}
              className={`term-line ${r.level ? `term-${r.level}` : ""} ${r.line.hidden ? "term-hidden" : ""} ${matches[cursor] === r.index ? "term-current" : ""}`}
            >
              <span className="term-n">{r.index + 1}</span>
              {times && r.line.time && (
                <span className="term-time">{clock(r.line.time)}</span>
              )}
              <span className="term-text">{highlight(r.line.text, term)}</span>
            </div>
          ))
        )}
        {live && !error && <div className="term-caret" aria-hidden />}
      </div>
      <div className="console-foot">
        <span className="mono">
          {visible.length} / {rows.length} lines
        </span>
        {!follow && (
          <button className="jump" onClick={() => setFollow(true)}>
            <Icon name="arrowDown" size={14} />
            Jump to latest
          </button>
        )}
        <span className="mono console-follow">
          <span className={`live-dot ${live && follow ? "on" : ""}`} />
          {live ? (follow ? "Following" : "Paused scroll") : "Complete"}
        </span>
      </div>
    </div>
  );
}

export type RuntimeTarget = {
  id: string;
  type: "app" | "database" | "service-application" | "service-database";
  serviceId?: string;
  name: string;
};
const isoPrefix = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s?(.*)$/;
export function RuntimeLogs({ target }: { target: RuntimeTarget }) {
  const [paused, setPaused] = useState(false);
  const [count, setCount] = useState("500");
  const query = useQuery({
    queryKey: ["logs", target.type, target.id, count],
    queryFn: () =>
      api(
        `logs?id=${encodeURIComponent(target.id)}&type=${target.type}&lines=${count}${target.serviceId ? `&serviceId=${encodeURIComponent(target.serviceId)}` : ""}`,
        z.object({ logs: z.string() }),
      ),
    refetchInterval: paused ? false : 3000,
  });
  const lines = useMemo<LogLine[]>(
    () =>
      (query.data?.logs ?? "")
        .split("\n")
        .filter((line, i, all) => line || i < all.length - 1)
        .map((raw) => {
          const match = isoPrefix.exec(raw);
          return {
            time: match?.[1] ?? "",
            text: match ? (match[2] ?? "") : raw,
            stream: "stdout",
            hidden: false,
            command: "",
          };
        }),
    [query.data],
  );
  return (
    <LogConsole
      lines={lines}
      live={!paused}
      loading={query.isLoading}
      error={query.isError ? query.error.message : undefined}
      fileName={`${target.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.log`}
      emptyText="The container has not written any output yet."
      status={
        <button
          className={`pill pill-button ${paused ? "s-stopped" : "s-running"}`}
          onClick={() => setPaused(!paused)}
          title={paused ? "Resume live tail" : "Pause live tail"}
        >
          <span className="dot" />
          {paused ? "Paused" : "Live"}
          <Icon name={paused ? "play" : "pause"} size={13} />
        </button>
      }
      toolbar={
        <select
          className="mini-select mono"
          aria-label="Lines to load"
          value={count}
          onChange={(e) => setCount(e.target.value)}
        >
          {["100", "500", "1000", "5000"].map((n) => (
            <option key={n} value={n}>
              {n} lines
            </option>
          ))}
        </select>
      }
    />
  );
}
