"use client";
import { useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  accentPresets,
  defaultAppearance,
  lookPresets,
  normalizeAppearance,
  overviewSections,
  type Appearance,
} from "@/lib/appearance";
import { Button } from "./ui/button";
import { Icon, type IconName } from "./ui/icon";
import { copyText, Kbd, Segmented, Switch } from "./kit";
import { useAppearance } from "./appearance";

type Section = "presets" | "color" | "type" | "layout" | "details" | "overview";
const sections: { id: Section; label: string; icon: IconName }[] = [
  { id: "presets", label: "Presets", icon: "stars" },
  { id: "color", label: "Color", icon: "palette" },
  { id: "type", label: "Type", icon: "document" },
  { id: "layout", label: "Layout", icon: "overview" },
  { id: "details", label: "Details", icon: "tuning" },
  { id: "overview", label: "Overview", icon: "home" },
];

function Row({
  title,
  hint,
  children,
  stacked = false,
}: {
  title: string;
  hint: ReactNode;
  children: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className={`look-row ${stacked ? "stacked" : ""}`}>
      <span className="row-text">
        <span className="row-title">{title}</span>
        <span className="row-sub wrap">{hint}</span>
      </span>
      <div className="look-control">{children}</div>
    </div>
  );
}
function cap(value: string) {
  return value[0]?.toUpperCase() + value.slice(1);
}
// Segmented control bound to one appearance key.
function Choice<K extends keyof Appearance>({
  field,
  options,
}: {
  field: K;
  options: { value: Appearance[K] & string; label: ReactNode }[];
}) {
  const { appearance, update } = useAppearance();
  return (
    <Segmented
      value={appearance[field] as string}
      onChange={(value) => update({ [field]: value } as Partial<Appearance>)}
      options={options}
    />
  );
}
const fonts: { id: Appearance["font"]; label: string; family: string }[] = [
  { id: "geist", label: "Geist", family: "var(--font-geist)" },
  { id: "inter", label: "Inter", family: "var(--font-inter)" },
  { id: "plex", label: "IBM Plex", family: "var(--font-plex)" },
  { id: "manrope", label: "Manrope", family: "var(--font-manrope)" },
  { id: "space", label: "Space Grotesk", family: "var(--font-space)" },
  {
    id: "system",
    label: "System",
    family: "system-ui, -apple-system, sans-serif",
  },
];
const monos: { id: Appearance["mono"]; label: string; family: string }[] = [
  { id: "geist", label: "Geist Mono", family: "var(--font-geist-mono)" },
  { id: "jetbrains", label: "JetBrains Mono", family: "var(--font-jetbrains)" },
  { id: "plex", label: "IBM Plex Mono", family: "var(--font-plex-mono)" },
];
const tones: { id: Appearance["tone"]; label: string; hint: string }[] = [
  { id: "neutral", label: "Neutral", hint: "Balanced grays" },
  { id: "slate", label: "Slate", hint: "Cool blue-gray" },
  { id: "stone", label: "Stone", hint: "Warm paper" },
  { id: "tinted", label: "Tinted", hint: "Washed in accent" },
  { id: "oled", label: "OLED", hint: "True black in dark" },
];
const terminals: {
  id: Appearance["terminal"];
  label: string;
  colors: string[];
}[] = [
  {
    id: "midnight",
    label: "Midnight",
    colors: ["#0a0b0e", "#c4c8d2", "#8fe3b3", "#ff9a9a"],
  },
  {
    id: "dracula",
    label: "Dracula",
    colors: ["#282a36", "#f8f8f2", "#50fa7b", "#ff5555"],
  },
  {
    id: "nord",
    label: "Nord",
    colors: ["#2e3440", "#d8dee9", "#a3be8c", "#bf616a"],
  },
  {
    id: "solarized",
    label: "Solarized",
    colors: ["#002b36", "#93a1a1", "#859900", "#dc322f"],
  },
  {
    id: "paper",
    label: "Paper",
    colors: ["#fbf8f1", "#3b3a36", "#3f7d3a", "#c0392b"],
  },
];
const tiles: { icon: IconName; hue: string }[] = [
  { icon: "apps", hue: "app" },
  { icon: "database", hue: "database" },
  { icon: "service", hue: "service" },
  { icon: "deploy", hue: "deploy" },
];

export function AppearanceSettings() {
  const [section, setSection] = useState<Section>("presets");
  const { reset } = useAppearance();
  return (
    <div className="look">
      <nav className="look-tabs" aria-label="Appearance sections">
        {sections.map((s) => (
          <button
            key={s.id}
            className={`look-tab ${section === s.id ? "active" : ""}`}
            onClick={() => setSection(s.id)}
          >
            <Icon name={s.icon} size={15} />
            {s.label}
          </button>
        ))}
      </nav>
      <div className="look-body" key={section}>
        {section === "presets" && <Presets />}
        {section === "color" && <ColorSection />}
        {section === "type" && <TypeSection />}
        {section === "layout" && <LayoutSection />}
        {section === "details" && <DetailsSection />}
        {section === "overview" && <OverviewSection />}
      </div>
      <div className="look-foot">
        <span className="muted small">
          Saved in this browser. Changes apply instantly.
        </span>
        <Button variant="ghost" size="sm" onClick={reset}>
          <Icon name="restart" size={15} />
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}

function Presets() {
  const { appearance, update } = useAppearance();
  const { setTheme } = useTheme();
  const [importing, setImporting] = useState(false);
  const [json, setJson] = useState("");
  return (
    <>
      <Row
        title="Looks"
        hint="Start from a complete style, then fine-tune any detail."
        stacked
      >
        <div className="preset-grid">
          {lookPresets.map((p) => (
            <button
              key={p.id}
              className="preset-card"
              onClick={() => {
                update({
                  ...defaultAppearance,
                  name: appearance.name,
                  hidden: appearance.hidden,
                  ...p.values,
                });
                setTheme(p.theme);
                toast.success(`${p.label} look applied`);
              }}
            >
              <span
                className="preset-swatch"
                style={{ background: p.swatch[0] }}
              >
                <span style={{ background: p.swatch[1] }} />
                <span style={{ background: p.swatch[2] }} />
                <i style={{ background: p.swatch[1] }} />
              </span>
              <span className="row-text">
                <span className="row-title">{p.label}</span>
                <span className="row-sub wrap">{p.description}</span>
              </span>
            </button>
          ))}
        </div>
      </Row>
      <Row
        title="Share your look"
        hint="Copy these settings to another browser, or paste someone else’s."
      >
        <div className="look-inline">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const { name: _name, hidden: _hidden, ...look } = appearance;
              void copyText(JSON.stringify(look), "Look copied as JSON");
            }}
          >
            <Icon name="copy" size={15} />
            Copy
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImporting(!importing)}
          >
            <Icon name="download" size={15} />
            Import
          </Button>
        </div>
      </Row>
      {importing && (
        <form
          className="look-import"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const parsed: unknown = JSON.parse(json);
              const next = normalizeAppearance({
                ...appearance,
                ...(parsed as object),
              });
              update({
                ...next,
                name: appearance.name,
                hidden: appearance.hidden,
              });
              toast.success("Look imported");
              setImporting(false);
              setJson("");
            } catch {
              toast.error("That isn’t valid look JSON.");
            }
          }}
        >
          <textarea
            className="code-input"
            rows={4}
            autoFocus
            spellCheck={false}
            placeholder='{"accent":"rose","hue":12,…}'
            value={json}
            onChange={(e) => setJson(e.target.value)}
          />
          <div className="dialog-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setImporting(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!json.trim()}>
              Apply
            </Button>
          </div>
        </form>
      )}
    </>
  );
}

function ColorSection() {
  const { appearance: a, update } = useAppearance();
  const { theme, setTheme } = useTheme();
  const custom = !accentPresets.some((p) => p.id === a.accent);
  return (
    <>
      <Row
        title="Theme"
        hint={
          <>
            Press <Kbd>T</Kbd> to flip between light and dark.
          </>
        }
        stacked
      >
        <div className="theme-grid">
          {(
            [
              { value: "light", label: "Light", icon: "sun" },
              { value: "dark", label: "Dark", icon: "moon" },
              { value: "system", label: "System", icon: "monitor" },
            ] as const
          ).map((t) => (
            <button
              key={t.value}
              onClick={() => setTheme(t.value)}
              className={`theme-card theme-${t.value} ${theme === t.value ? "selected" : ""}`}
            >
              <span className="theme-preview">
                <span />
                <span />
                <span />
              </span>
              <span className="theme-label">
                <Icon name={t.icon} size={15} />
                {t.label}
              </span>
            </button>
          ))}
        </div>
      </Row>
      <Row
        title="Accent color"
        hint="Buttons, focus rings, active states and links."
        stacked
      >
        <div className="swatches">
          {accentPresets.map((p) => (
            <button
              key={p.id}
              className={`swatch ${a.accent === p.id ? "selected" : ""}`}
              style={{ ["--sw" as string]: `oklch(0.6 ${p.chroma} ${p.hue})` }}
              title={p.label}
              aria-label={p.label}
              aria-pressed={a.accent === p.id}
              onClick={() =>
                update({ accent: p.id, hue: p.hue, chroma: p.chroma })
              }
            >
              {a.accent === p.id && <Icon name="check" size={14} />}
            </button>
          ))}
          <button
            className={`swatch swatch-custom ${custom ? "selected" : ""}`}
            title="Custom"
            aria-label="Custom accent"
            onClick={() => update({ accent: "custom" })}
          >
            <Icon name="palette" size={14} />
          </button>
        </div>
        {custom && (
          <div className="sliders">
            <label className="slider">
              <span>Hue</span>
              <input
                type="range"
                min={0}
                max={360}
                value={a.hue}
                className="hue-range"
                onChange={(e) => update({ hue: Number(e.target.value) })}
              />
              <span className="mono">{a.hue}°</span>
            </label>
            <label className="slider">
              <span>Intensity</span>
              <input
                type="range"
                min={0}
                max={0.28}
                step={0.01}
                value={a.chroma}
                className="chroma-range"
                onChange={(e) => update({ chroma: Number(e.target.value) })}
              />
              <span className="mono">
                {Math.round((a.chroma / 0.28) * 100)}%
              </span>
            </label>
          </div>
        )}
      </Row>
      <Row
        title="Base tone"
        hint="The color temperature of backgrounds and surfaces."
        stacked
      >
        <div className="tone-grid">
          {tones.map((t) => (
            <button
              key={t.id}
              className={`tone-card tone-${t.id} ${a.tone === t.id ? "selected" : ""}`}
              onClick={() => update({ tone: t.id })}
            >
              <span className="tone-preview">
                <span />
                <span />
              </span>
              <span className="font-name">{t.label}</span>
              <small>{t.hint}</small>
            </button>
          ))}
        </div>
      </Row>
      <Row
        title="Category colors"
        hint="How apps, databases and services are tinted."
      >
        <div className="look-inline">
          <span className="palette-sample" aria-hidden>
            {tiles.map((t) => (
              <span key={t.icon} className={`tile tile-sm hue-${t.hue}`}>
                <Icon name={t.icon} size={13} />
              </span>
            ))}
          </span>
          <Choice
            field="palette"
            options={[
              { value: "colorful", label: "Colorful" },
              { value: "accent", label: "Accent" },
              { value: "mono", label: "Mono" },
            ]}
          />
        </div>
      </Row>
      <Row
        title="Status colors"
        hint="Color-blind safe swaps green/red for blue/orange."
      >
        <div className="look-inline">
          <span className="status-sample" aria-hidden>
            <span className="pill s-running">
              <span className="dot" />
              Running
            </span>
            <span className="pill s-failed">
              <span className="dot" />
              Failed
            </span>
          </span>
          <Choice
            field="status"
            options={[
              { value: "default", label: "Default" },
              { value: "accessible", label: "Color-blind safe" },
            ]}
          />
        </div>
      </Row>
      <Row title="Contrast" hint="Strength of secondary text and borders.">
        <Choice
          field="contrast"
          options={[
            { value: "soft", label: "Soft" },
            { value: "standard", label: "Standard" },
            { value: "high", label: "High" },
          ]}
        />
      </Row>
      <Row
        title="Primary buttons"
        hint="Fill style of the main action buttons."
      >
        <div className="look-inline">
          <span
            className="button button-default button-sm button-sample"
            aria-hidden
          >
            <Icon name="deploy" size={14} />
            Deploy
          </span>
          <Choice
            field="buttons"
            options={[
              { value: "gradient", label: "Gradient" },
              { value: "solid", label: "Solid" },
              { value: "glow", label: "Glow" },
            ]}
          />
        </div>
      </Row>
    </>
  );
}

function TypeSection() {
  const { appearance: a, update } = useAppearance();
  return (
    <>
      <Row
        title="Interface font"
        hint="Used for everything except code and numbers."
        stacked
      >
        <div className="font-grid">
          {fonts.map((f) => (
            <button
              key={f.id}
              className={`font-card ${a.font === f.id ? "selected" : ""}`}
              onClick={() => update({ font: f.id })}
            >
              <span className="font-sample" style={{ fontFamily: f.family }}>
                Aa
              </span>
              <span className="font-name">{f.label}</span>
            </button>
          ))}
        </div>
      </Row>
      <Row
        title="Code font"
        hint="Logs, environment variables, domains and numbers."
      >
        <Choice
          field="mono"
          options={monos.map((m) => ({
            value: m.id,
            label: <span style={{ fontFamily: m.family }}>{m.label}</span>,
          }))}
        />
      </Row>
      <Row
        title="Interface scale"
        hint="Zoom the whole app. Handy on large or high-density screens."
      >
        <Choice
          field="scale"
          options={(["90", "100", "110", "125"] as const).map((v) => ({
            value: v,
            label: `${v}%`,
          }))}
        />
      </Row>
      <Row title="Headings" hint="Weight of page and section titles.">
        <Choice
          field="headings"
          options={(["regular", "semibold", "bold"] as const).map((v) => ({
            value: v,
            label: (
              <span className={`heading-sample heading-${v}`}>{cap(v)}</span>
            ),
          }))}
        />
      </Row>
      <Row title="Icons" hint="Weight of the second tone in duotone icons.">
        <Choice
          field="icons"
          options={(["duotone", "soft", "solid"] as const).map((v) => ({
            value: v,
            label: (
              <>
                <span className={`icon-sample icons-${v}`}>
                  <Icon name="deploy" size={15} />
                </span>
                {cap(v)}
              </>
            ),
          }))}
        />
      </Row>
    </>
  );
}

function LayoutSection() {
  const { appearance: a, update } = useAppearance();
  return (
    <>
      <Row title="Density" hint="Row height, spacing and text size.">
        <Choice
          field="density"
          options={[
            { value: "compact", label: "Compact" },
            { value: "comfortable", label: "Comfortable" },
            { value: "spacious", label: "Spacious" },
          ]}
        />
      </Row>
      <Row title="Content width" hint="How wide pages grow on large screens.">
        <Choice
          field="width"
          options={[
            { value: "standard", label: "Standard" },
            { value: "wide", label: "Wide" },
            { value: "full", label: "Full" },
          ]}
        />
      </Row>
      <Row
        title="Sidebar"
        hint={
          <>
            Icon rail collapses labels. Toggle anytime with <Kbd>\</Kbd>
          </>
        }
      >
        <Choice
          field="sidebar"
          options={[
            { value: "expanded", label: "Expanded" },
            { value: "compact", label: "Icon rail" },
          ]}
        />
      </Row>
      <Row title="Sidebar position" hint="Dock navigation on either side.">
        <Choice
          field="side"
          options={[
            { value: "left", label: "Left" },
            { value: "right", label: "Right" },
          ]}
        />
      </Row>
      <Row title="Corners" hint="Roundness of cards, buttons and inputs.">
        <Choice
          field="radius"
          options={(["sharp", "default", "round"] as const).map((r) => ({
            value: r,
            label: (
              <>
                <span className={`corner-sample corner-${r}`} />
                {r === "default" ? "Soft" : cap(r)}
              </>
            ),
          }))}
        />
      </Row>
      <Row title="Surfaces" hint="Soft shadows or flat outlined cards.">
        <Choice
          field="surface"
          options={[
            { value: "elevated", label: "Elevated" },
            { value: "flat", label: "Flat" },
          ]}
        />
      </Row>
      <Row title="Tabs" hint="Style of resource tabs and section switchers.">
        <Choice
          field="tabs"
          options={[
            { value: "underline", label: "Underline" },
            { value: "pills", label: "Pills" },
          ]}
        />
      </Row>
      <Row title="Background" hint="Texture behind your pages." stacked>
        <div className="bg-grid">
          {(["plain", "dots", "grid", "glow"] as const).map((b) => (
            <button
              key={b}
              className={`bg-card ${a.background === b ? "selected" : ""}`}
              onClick={() => update({ background: b })}
            >
              <span className={`bg-preview bg-${b}`} />
              <span className="font-name">{cap(b)}</span>
            </button>
          ))}
        </div>
      </Row>
    </>
  );
}

function DetailsSection() {
  const { appearance: a, update } = useAppearance();
  return (
    <>
      <Row
        title="Your name"
        hint="Used in the overview greeting and your avatar."
      >
        <input
          className="look-input"
          value={a.name}
          maxLength={40}
          placeholder="Your name"
          onChange={(e) => update({ name: e.target.value })}
        />
      </Row>
      <Row
        title="Log terminal theme"
        hint="Colors for deployment and runtime logs."
        stacked
      >
        <div className="terminal-grid">
          {terminals.map((t) => (
            <button
              key={t.id}
              className={`terminal-card ${a.terminal === t.id ? "selected" : ""}`}
              onClick={() => update({ terminal: t.id })}
            >
              <span
                className="terminal-preview"
                style={{ background: t.colors[0], color: t.colors[1] }}
              >
                <span>$ deploy</span>
                <span style={{ color: t.colors[2] }}>✓ healthy</span>
                <span style={{ color: t.colors[3] }}>✗ error</span>
              </span>
              <span className="font-name">{t.label}</span>
            </button>
          ))}
        </div>
      </Row>
      <Row title="Timestamps" hint="“5m ago” or the exact date and time.">
        <Choice
          field="timestamps"
          options={[
            { value: "relative", label: "Relative" },
            { value: "absolute", label: "Exact" },
          ]}
        />
      </Row>
      <Row title="Clock" hint="Time format for exact timestamps and logs.">
        <Choice
          field="clock"
          options={[
            { value: "24h", label: "24-hour" },
            { value: "12h", label: "12-hour" },
          ]}
        />
      </Row>
      <Row
        title="Keyboard hints"
        hint="Show shortcut badges next to buttons and menu items."
      >
        <Choice
          field="hints"
          options={[
            { value: "show", label: "Show" },
            { value: "hide", label: "Hide" },
          ]}
        />
      </Row>
      <Row title="Motion" hint="Page transitions, pulses and live indicators.">
        <Choice
          field="motion"
          options={[
            { value: "full", label: "Full" },
            { value: "reduced", label: "Reduced" },
          ]}
        />
      </Row>
    </>
  );
}

function OverviewSection() {
  const { appearance: a, update } = useAppearance();
  return (
    <Row
      title="Overview sections"
      hint="Choose what the overview page shows."
      stacked
    >
      <div className="section-toggles">
        {overviewSections.map((s) => {
          const shown = !a.hidden.includes(s.id);
          return (
            <label
              key={s.id}
              className={`section-toggle ${shown ? "" : "off"}`}
            >
              <span>{s.label}</span>
              <Switch
                checked={shown}
                label={`Show ${s.label}`}
                onChange={(on) =>
                  update({
                    hidden: on
                      ? a.hidden.filter((h) => h !== s.id)
                      : [...a.hidden, s.id],
                  })
                }
              />
            </label>
          );
        })}
      </div>
    </Row>
  );
}
