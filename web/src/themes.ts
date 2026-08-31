import type { BundledTheme } from "shiki";

import { CUSTOM_THEMES } from "./claudeTheme";

export { CUSTOM_THEMES } from "./claudeTheme";

/**
 * A theme by name: one of Shiki's, or one this app ships itself. The two are
 * interchangeable everywhere downstream — a custom theme is loaded rather than
 * fetched, and nothing else has to know which it got.
 */
export type ThemeName = BundledTheme | keyof typeof CUSTOM_THEMES;

/**
 * Predefined themes. Chrome is derived from the editor theme's own colours
 * rather than hand-authored per theme, so the app can never clash with the
 * code, and adding a theme is one line here.
 */

export interface ThemeChoice {
  readonly id: string;
  readonly label: string;
  readonly shiki: ThemeName;
  readonly dark: boolean;
}

export const SYSTEM = "system";

export const THEMES: readonly ThemeChoice[] = [
  { id: "claude-light", label: "Claude Light", shiki: "claude-light", dark: false },
  { id: "github-light", label: "GitHub Light", shiki: "github-light", dark: false },
  { id: "vitesse-light", label: "Vitesse Light", shiki: "vitesse-light", dark: false },
  { id: "catppuccin-latte", label: "Catppuccin Latte", shiki: "catppuccin-latte", dark: false },
  { id: "claude-dark", label: "Claude Dark", shiki: "claude-dark", dark: true },
  { id: "github-dark", label: "GitHub Dark", shiki: "github-dark", dark: true },
  { id: "github-dark-dimmed", label: "GitHub Dimmed", shiki: "github-dark-dimmed", dark: true },
  { id: "one-dark-pro", label: "One Dark Pro", shiki: "one-dark-pro", dark: true },
  { id: "nord", label: "Nord", shiki: "nord", dark: true },
  { id: "tokyo-night", label: "Tokyo Night", shiki: "tokyo-night", dark: true },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha", shiki: "catppuccin-mocha", dark: true },
];

export const SYSTEM_LIGHT: ThemeName = "github-light";
export const SYSTEM_DARK: ThemeName = "github-dark";

/* ── colour helpers ──────────────────────────────────────────── */

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parse(value: string | undefined): Rgb | null {
  if (!value) return null;
  const hex = value.trim().replace("#", "");
  const full =
    hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.length <= 6 ? hex.padEnd(6, "0") : hex;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(full)) return null;
  const a = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
  if (a === 0) return null; // fully transparent is not a colour we can use
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a,
  };
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const css = ({ r, g, b }: Rgb) => `rgb(${clamp(r)} ${clamp(g)} ${clamp(b)})`;

/** `amount` of `a` over `b`. */
function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return {
    r: a.r * amount + b.r * (1 - amount),
    g: a.g * amount + b.g * (1 - amount),
    b: a.b * amount + b.b * (1 - amount),
    a: 1,
  };
}

/** Composite a partly transparent colour over its background. */
const flatten = (c: Rgb, bg: Rgb) => (c.a >= 1 ? c : mix(c, bg, c.a));

const luminance = ({ r, g, b }: Rgb) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export interface ShikiThemeColours {
  readonly bg?: string;
  readonly fg?: string;
  readonly type?: string;
  readonly colors?: Readonly<Record<string, string>>;
}

/**
 * Map an editor theme onto the app's design tokens.
 * Every lookup falls back to a mix of background and foreground, so a theme
 * missing a key degrades rather than breaking.
 */
export function deriveTokens(theme: ShikiThemeColours): Record<string, string> {
  const colors = theme.colors ?? {};
  const bg = parse(theme.bg) ?? parse(colors["editor.background"]) ?? { r: 255, g: 255, b: 255, a: 1 };
  const fg = parse(theme.fg) ?? parse(colors["editor.foreground"]) ?? { r: 16, g: 23, b: 32, a: 1 };
  const dark = theme.type === "dark" || luminance(bg) < 0.5;

  const at = (key: string) => {
    const found = parse(colors[key]);
    return found ? flatten(found, bg) : null;
  };
  const toward = (amount: number) => mix(fg, bg, amount);

  const accent = at("textLink.foreground") ?? at("editorLink.activeForeground") ?? toward(0.65);
  const added = at("editorGutter.addedBackground") ?? { r: 31, g: 122, b: 70, a: 1 };
  const deleted = at("editorGutter.deletedBackground") ?? { r: 168, g: 58, b: 50, a: 1 };
  const flag = dark ? { r: 213, g: 160, b: 60, a: 1 } : { r: 154, g: 98, b: 0, a: 1 };

  return {
    "--surface": css(bg),
    "--ground": css(at("editorGroupHeader.tabsBackground") ?? mix(fg, bg, dark ? 0.04 : 0.05)),
    "--surface-2": css(mix(fg, bg, 0.04)),
    "--surface-3": css(at("list.activeSelectionBackground") ?? mix(fg, bg, 0.1)),
    "--line": css(at("panel.border") ?? at("editorGroup.border") ?? mix(fg, bg, 0.18)),
    "--line-soft": css(mix(fg, bg, 0.09)),
    "--ink": css(fg),
    "--muted": css(toward(0.68)),
    "--faint": css(at("editorLineNumber.foreground") ?? toward(0.45)),
    "--accent": css(accent),
    "--accent-ink": luminance(accent) > 0.55 ? "rgb(12 16 20)" : "rgb(255 255 255)",
    "--accent-soft": css(mix(accent, bg, dark ? 0.22 : 0.16)),
    "--add": css(added),
    "--del": css(deleted),
    "--flag": css(flag),
    "--flag-soft": css(mix(flag, bg, 0.18)),
    "--stale": css(flag),
    "--ring0": css(accent),
    "--ring1": css(mix(accent, bg, 0.72)),
    "--ring2": css(mix(accent, bg, 0.48)),
    "--ring3": css(mix(accent, bg, 0.28)),
    "--ring-out": css(mix(fg, bg, 0.28)),
    "--shadow": dark
      ? "0 1px 2px rgba(0,0,0,.45), 0 8px 26px rgba(0,0,0,.5)"
      : "0 1px 2px rgba(16,23,32,.07), 0 8px 26px rgba(16,23,32,.10)",
  };
}
