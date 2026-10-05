// Appearance preferences live in this browser's localStorage and are applied as
// data attributes and CSS variables on <html>. Theme (light/dark) stays with next-themes.
export const appearanceOptions = {
  palette: ["colorful", "accent", "mono"],
  density: ["compact", "comfortable", "spacious"],
  radius: ["sharp", "default", "round"],
  font: ["geist", "inter", "plex", "manrope", "space", "system"],
  mono: ["geist", "jetbrains", "plex"],
  icons: ["duotone", "soft", "solid"],
  background: ["plain", "dots", "grid", "glow"],
  sidebar: ["expanded", "compact"],
  surface: ["elevated", "flat"],
  motion: ["full", "reduced"],
  tone: ["neutral", "slate", "stone", "tinted", "oled"],
  contrast: ["soft", "standard", "high"],
  status: ["default", "accessible"],
  buttons: ["gradient", "solid", "glow"],
  tabs: ["underline", "pills"],
  terminal: ["midnight", "dracula", "nord", "solarized", "paper"],
  width: ["standard", "wide", "full"],
  side: ["left", "right"],
  scale: ["90", "100", "110", "125"],
  headings: ["regular", "semibold", "bold"],
  hints: ["show", "hide"],
  timestamps: ["relative", "absolute"],
  clock: ["24h", "12h"],
} as const;
type Options = typeof appearanceOptions;
export type OverviewSection =
  "hero" | "kpis" | "apps" | "deployments" | "server" | "services" | "promo";
export const overviewSections: { id: OverviewSection; label: string }[] = [
  { id: "hero", label: "Health banner" },
  { id: "kpis", label: "Resource counters" },
  { id: "apps", label: "Applications" },
  { id: "deployments", label: "Recent deployments" },
  { id: "server", label: "Server gauges" },
  { id: "services", label: "Services" },
  { id: "promo", label: "Coolify shortcut" },
];
export type Appearance = { [K in keyof Options]: Options[K][number] } & {
  accent: string;
  hue: number;
  chroma: number;
  name: string;
  hidden: OverviewSection[];
};
export const accentPresets: {
  id: string;
  label: string;
  hue: number;
  chroma: number;
}[] = [
  { id: "indigo", label: "Indigo", hue: 272, chroma: 0.22 },
  { id: "violet", label: "Violet", hue: 300, chroma: 0.22 },
  { id: "blue", label: "Blue", hue: 250, chroma: 0.2 },
  { id: "sky", label: "Sky", hue: 225, chroma: 0.16 },
  { id: "teal", label: "Teal", hue: 190, chroma: 0.13 },
  { id: "emerald", label: "Emerald", hue: 158, chroma: 0.16 },
  { id: "lime", label: "Lime", hue: 128, chroma: 0.19 },
  { id: "amber", label: "Amber", hue: 65, chroma: 0.17 },
  { id: "orange", label: "Orange", hue: 42, chroma: 0.2 },
  { id: "rose", label: "Rose", hue: 12, chroma: 0.21 },
  { id: "pink", label: "Pink", hue: 345, chroma: 0.2 },
  { id: "graphite", label: "Graphite", hue: 265, chroma: 0.02 },
];
export const defaultAppearance: Appearance = {
  accent: "indigo",
  hue: 272,
  chroma: 0.22,
  palette: "colorful",
  density: "comfortable",
  radius: "default",
  font: "geist",
  mono: "geist",
  icons: "duotone",
  background: "plain",
  sidebar: "expanded",
  surface: "elevated",
  motion: "full",
  tone: "neutral",
  contrast: "standard",
  status: "default",
  buttons: "gradient",
  tabs: "underline",
  terminal: "midnight",
  width: "standard",
  side: "left",
  scale: "100",
  headings: "semibold",
  hints: "show",
  timestamps: "relative",
  clock: "24h",
  name: "Ashok",
  hidden: [],
};
// One-click looks. `theme` is applied through next-themes alongside.
export const lookPresets: {
  id: string;
  label: string;
  description: string;
  theme: "light" | "dark";
  swatch: string[];
  values: Partial<Appearance>;
}[] = [
  {
    id: "default",
    label: "Homebase",
    description: "The original: indigo, soft and calm.",
    theme: "light",
    swatch: ["#fbfbfc", "oklch(0.55 0.22 272)", "#111318"],
    values: {},
  },
  {
    id: "terminal",
    label: "Terminal",
    description: "OLED black, lime accent, monospace everything.",
    theme: "dark",
    swatch: ["#000", "oklch(0.75 0.19 128)", "#1a1a1a"],
    values: {
      accent: "lime",
      hue: 128,
      chroma: 0.19,
      tone: "oled",
      font: "space",
      mono: "jetbrains",
      radius: "sharp",
      surface: "flat",
      buttons: "solid",
      tabs: "underline",
      terminal: "midnight",
      background: "grid",
      palette: "accent",
      density: "compact",
    },
  },
  {
    id: "paper",
    label: "Paper",
    description: "Warm stone, crisp corners, editorial type.",
    theme: "light",
    swatch: ["#f6f3ee", "oklch(0.55 0.2 42)", "#2b2620"],
    values: {
      accent: "orange",
      hue: 42,
      chroma: 0.2,
      tone: "stone",
      font: "plex",
      mono: "plex",
      radius: "sharp",
      surface: "flat",
      buttons: "solid",
      tabs: "underline",
      terminal: "paper",
      background: "plain",
      icons: "soft",
      headings: "bold",
    },
  },
  {
    id: "neon",
    label: "Neon",
    description: "Dark slate with a glowing pink accent.",
    theme: "dark",
    swatch: ["#0d0f17", "oklch(0.7 0.2 345)", "oklch(0.7 0.15 250)"],
    values: {
      accent: "pink",
      hue: 345,
      chroma: 0.2,
      tone: "slate",
      font: "manrope",
      radius: "round",
      buttons: "glow",
      tabs: "pills",
      terminal: "dracula",
      background: "glow",
      icons: "solid",
    },
  },
  {
    id: "nordic",
    label: "Nordic",
    description: "Cool slate, teal accent, Nord terminal.",
    theme: "dark",
    swatch: ["#2e3440", "oklch(0.72 0.11 200)", "#d8dee9"],
    values: {
      accent: "teal",
      hue: 190,
      chroma: 0.13,
      tone: "slate",
      font: "inter",
      radius: "default",
      terminal: "nord",
      tabs: "pills",
      background: "dots",
      buttons: "solid",
    },
  },
  {
    id: "focus",
    label: "Focus",
    description: "Monochrome and quiet. Nothing competes for attention.",
    theme: "light",
    swatch: ["#fff", "oklch(0.55 0.02 265)", "#111"],
    values: {
      accent: "graphite",
      hue: 265,
      chroma: 0.02,
      palette: "mono",
      surface: "flat",
      buttons: "solid",
      hints: "hide",
      motion: "reduced",
      icons: "soft",
      contrast: "high",
    },
  },
];
export const appearanceKey = "homebase-appearance";
const attributeKeys = Object.keys(appearanceOptions) as (keyof Options)[];
export function normalizeAppearance(value: unknown): Appearance {
  const input = (typeof value === "object" && value ? value : {}) as Record<
    string,
    unknown
  >;
  const result: Appearance = { ...defaultAppearance };
  for (const key of attributeKeys) {
    const allowed = appearanceOptions[key] as readonly string[];
    if (
      typeof input[key] === "string" &&
      allowed.includes(input[key] as string)
    )
      (result as Record<string, unknown>)[key] = input[key];
  }
  if (typeof input.accent === "string")
    result.accent = input.accent.slice(0, 20);
  const hue = Number(input.hue);
  if (input.hue !== undefined && Number.isFinite(hue))
    result.hue = Math.min(360, Math.max(0, hue));
  const chroma = Number(input.chroma);
  if (input.chroma !== undefined && Number.isFinite(chroma))
    result.chroma = Math.min(0.3, Math.max(0, chroma));
  if (typeof input.name === "string")
    result.name = input.name.trim().slice(0, 40);
  if (Array.isArray(input.hidden))
    result.hidden = overviewSections
      .map((s) => s.id)
      .filter((id) => (input.hidden as unknown[]).includes(id));
  return result;
}
export function applyAppearance(appearance: Appearance, root: HTMLElement) {
  for (const key of attributeKeys) root.dataset[key] = String(appearance[key]);
  root.style.setProperty("--accent-h", String(appearance.hue));
  root.style.setProperty("--accent-c", String(appearance.chroma));
}
// Runs before first paint so saved preferences never flash the defaults.
export const appearanceBootScript = `(function(){try{var o=${JSON.stringify(appearanceOptions)};var d=${JSON.stringify(defaultAppearance)};var s=JSON.parse(localStorage.getItem(${JSON.stringify(appearanceKey)})||"{}");var r=document.documentElement;Object.keys(o).forEach(function(k){var v=o[k].indexOf(s[k])>-1?s[k]:d[k];r.dataset[k]=v;});var h=Number(s.hue),c=Number(s.chroma);r.style.setProperty("--accent-h",s.hue!==undefined&&isFinite(h)?h:d.hue);r.style.setProperty("--accent-c",s.chroma!==undefined&&isFinite(c)?c:d.chroma);}catch(e){}})();`;
