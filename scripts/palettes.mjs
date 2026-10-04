/**
 * Builds app/palettes.css: the six colour palettes of the app, each in light and dark.
 *
 *   pnpm palettes          writes app/palettes.css
 *   pnpm palettes --check  fails if the file is out of date or any text is not readable enough
 *
 * A palette is one hue for the accent and a faint tint of it for the neutrals. Every colour that
 * carries text is then adjusted until it meets its WCAG contrast ratio against every background it
 * sits on, so readability never depends on the hue picked:
 *   - main and secondary text, and text on brand buttons: 7 or more;
 *   - small grey text: 5.5 or more;
 *   - the faintest text (footers, placeholders), the accent and status colours: 4.5 or more.
 * The script throws if a ratio cannot be met.
 *
 * "sage" is the original M2smart look and the default. Status colours (positive, warning, danger)
 * keep their meaning in every palette.
 */
import { readFileSync, writeFileSync } from "node:fs";

const OUT = new URL("../app/palettes.css", import.meta.url);

/** name, accent hue and saturation, and the hue and strength of the tint of the neutrals. */
export const PALETTES = [
  { name: "sage", hue: 140, saturation: 19, tint: 11, neutralHue: 100 },
  { name: "ocean", hue: 212, saturation: 62, tint: 16 },
  { name: "violet", hue: 256, saturation: 50, tint: 14 },
  { name: "rose", hue: 342, saturation: 52, tint: 12 },
  { name: "sand", hue: 27, saturation: 58, tint: 18 },
  { name: "graphite", hue: 220, saturation: 9, tint: 5 },
];


// --- Colour maths ---------------------------------------------------------------------------------
function hex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
}
function luminance(color) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** The colour hsl(h, s, l) moved darker (light mode) or lighter (dark mode) until it reads on every background. */
function readable(h, s, l, backgrounds, ratio, dark) {
  for (let lightness = l; lightness >= 0 && lightness <= 100; lightness += dark ? 0.5 : -0.5) {
    const color = hex(h, s, lightness);
    if (backgrounds.every((background) => contrast(color, background) >= ratio)) return color;
  }
  throw new Error(`No readable colour for hue ${h} at ratio ${ratio}`);
}

// --- One palette ----------------------------------------------------------------------------------
function build({ hue: h, saturation: s, tint: t, neutralHue: n = h }, dark) {
  const c = {};
  if (!dark) {
    c.page = hex(n, t, 95.8);
    c.sidebar = hex(n, t, 97.2);
    c.surface = "#ffffff";
    c["surface-soft"] = hex(n, t, 96.8);
    c["surface-hover"] = hex(n, t, 94.2);
    c.line = hex(n, t, 91.4);
    c["line-strong"] = hex(n, t, 86.8);
    c["accent-soft"] = hex(h, Math.min(s * 0.55, 46), 94.2);
    c["accent-pale"] = hex(h, Math.min(s * 0.5, 40), 96.6);
    c.selection = hex(h, Math.min(s * 0.6, 50), 87);
  } else {
    c.page = hex(n, t * 0.8, 9.6);
    c.sidebar = hex(n, t * 0.8, 11.2);
    c.surface = hex(n, t * 0.8, 14);
    c["surface-soft"] = hex(n, t * 0.8, 16);
    c["surface-hover"] = hex(n, t * 0.8, 19.5);
    c.line = hex(n, t * 0.7, 21);
    c["line-strong"] = hex(n, t * 0.7, 28);
    c["accent-soft"] = hex(h, Math.min(s * 0.45, 34), 19);
    c["accent-pale"] = hex(h, Math.min(s * 0.4, 30), 15.6);
    c.selection = hex(h, Math.min(s * 0.5, 40), 30);
  }
  const backgrounds = [c.page, c.sidebar, c.surface, c["surface-soft"], c["surface-hover"]];
  const tinted = [...backgrounds, c["accent-soft"], c["accent-pale"]];
  c.ink = readable(n, t * 1.2, dark ? 92 : 14, tinted, 7, dark);
  c["ink-soft"] = readable(n, t * 0.8, dark ? 78 : 38, tinted, 7, dark);
  c.muted = readable(n, t * 0.6, dark ? 60 : 50, tinted, 5.5, dark);
  c.faint = readable(n, t * 0.5, dark ? 52 : 58, backgrounds, 4.5, dark);
  c.accent = readable(h, dark ? s * 0.7 : s, dark ? 68 : 42, tinted, 4.5, dark);
  c["accent-deep"] = readable(h, dark ? s * 0.6 : s, dark ? 80 : 30, tinted, 7, dark);
  c["accent-bright"] = hex(h, s * 0.75, dark ? 66 : 58);
  // Solid brand colour (logo mark, main buttons, brand panels) with white text on it, in both modes.
  c["on-brand"] = "#ffffff";
  c.brand = readable(h, Math.max(s, 12), dark ? 34 : 26, ["#ffffff"], 7, false);
  c["brand-hover"] = readable(h, Math.max(s, 12), dark ? 28 : 20, ["#ffffff"], 7, false);
  c["brand-tint"] = readable(h, s * 0.6, dark ? 66 : 50, [c.sidebar, c.surface], 3, dark);
  // Status colours mean the same in every palette; their text also sits on its own soft background.
  c["positive-soft"] = dark ? hex(140, 16, 19) : hex(140, 26, 95);
  c["warning-soft"] = dark ? hex(27, 24, 19) : hex(27, 64, 95);
  c.positive = readable(140, dark ? 30 : 22, dark ? 72 : 46, [...backgrounds, c["positive-soft"]], 4.5, dark);
  c.warning = readable(27, dark ? 62 : 46, dark ? 72 : 46, [...backgrounds, c["warning-soft"]], 4.5, dark);
  c.danger = readable(6, dark ? 70 : 43, dark ? 74 : 46, backgrounds, 4.5, dark);
  return c;
}

/** Every pair that carries text, with the ratio it must reach. */
function checks(c) {
  const backgrounds = ["page", "sidebar", "surface", "surface-soft", "surface-hover"];
  return [
    ...[...backgrounds, "accent-soft", "accent-pale"].flatMap((background) => [["ink", background, 7], ["ink-soft", background, 7], ["muted", background, 5.5], ["accent", background, 4.5], ["accent-deep", background, 7]]),
    ...backgrounds.flatMap((background) => [["faint", background, 4.5], ["positive", background, 4.5], ["warning", background, 4.5], ["danger", background, 4.5]]),
    ["on-brand", "brand", 7],
    ["on-brand", "brand-hover", 7],
    ["positive", "positive-soft", 4.5],
    ["warning", "warning-soft", 4.5],
  ].map(([text, background, ratio]) => ({ text, background, ratio, actual: contrast(c[text], c[background]) }));
}

// --- Output ---------------------------------------------------------------------------------------
let css = `/* Generated by scripts/palettes.mjs (pnpm palettes). Do not edit by hand. */\n`;
let lowest = Infinity;
for (const palette of PALETTES) {
  for (const dark of [false, true]) {
    const colors = build(palette, dark);
    for (const check of checks(colors)) {
      if (check.actual < check.ratio) throw new Error(`${palette.name} ${dark ? "dark" : "light"}: ${check.text} on ${check.background} is ${check.actual.toFixed(2)}, needs ${check.ratio}`);
      lowest = Math.min(lowest, check.actual);
    }
    const base = palette.name === "sage" ? ":root" : `:root[data-palette="${palette.name}"]`;
    const selector = dark ? `${base}[data-theme="dark"]` : base;
    css += `\n${selector} {\n${Object.entries(colors).map(([name, value]) => `  --${name}: ${value};`).join("\n")}\n}\n`;
    // The settings screen shows each palette's own colours, whatever palette is active.
    if (!dark) {
      const swatch = `.palette-picker > button[data-palette="${palette.name}"] .palette-swatch > i`;
      css += `${swatch}:nth-child(1) { background: ${colors.brand}; }\n${swatch}:nth-child(2) { background: ${colors["accent-bright"]}; }\n${swatch}:nth-child(3) { background: ${colors["accent-soft"]}; }\n`;
    }
  }
}

if (process.argv.includes("--check")) {
  const current = readFileSync(OUT, "utf8").replace(/\r\n/g, "\n");
  if (current !== css) {
    console.error("app/palettes.css is out of date: run pnpm palettes");
    process.exit(1);
  }
  console.log(`palettes: ${PALETTES.length} palettes × light and dark are readable (lowest text contrast ${lowest.toFixed(2)}:1) and app/palettes.css is up to date`);
} else {
  writeFileSync(OUT, css);
  console.log(`Wrote app/palettes.css: ${PALETTES.length} palettes × light and dark (lowest text contrast ${lowest.toFixed(2)}:1)`);
}
