import type { ThemeRegistration } from "shiki";

/**
 * Claude's palette as an editor theme: warm paper, ink, and clay for the
 * accent, rather than the blue every other theme reaches for.
 *
 * Written out as a Shiki theme rather than special-cased anywhere, so the app
 * chrome derives from it exactly the way it derives from a bundled one — the
 * `colors` keys below are the ones deriveTokens reads.
 */

/* Paper and ink */
const PAPER = "#faf9f5";
const PAPER_2 = "#f0eee6";
const PAPER_3 = "#e9e5d8";
const INK = "#1f1e1d";
const INK_SOFT = "#6e6a61";
const RULE = "#e3dfd3";

/* Night */
const NIGHT = "#1f1e1d";
const NIGHT_2 = "#262624";
const NIGHT_3 = "#2f2d2a";
const CREAM = "#f0eee6";
const CREAM_SOFT = "#a8a399";
const RULE_DARK = "#3a3733";

/* The one colour anyone would name: clay. */
const CLAY = "#c0562f";
const CLAY_LIGHT = "#e08a63";

const rule = (scope: string[], settings: Record<string, string>) => ({ scope, settings });

export const claudeLight: ThemeRegistration = {
  name: "claude-light",
  type: "light",
  colors: {
    "editor.background": PAPER,
    "editor.foreground": INK,
    "editorGroupHeader.tabsBackground": PAPER_2,
    "list.activeSelectionBackground": PAPER_3,
    "panel.border": RULE,
    "editorGroup.border": RULE,
    "editorLineNumber.foreground": "#a8a399",
    "textLink.foreground": CLAY,
    "editorGutter.addedBackground": "#5b7a3f",
    "editorGutter.deletedBackground": "#b3462f",
  },
  tokenColors: [
    rule(["comment", "punctuation.definition.comment"], {
      foreground: "#8f8b80",
      fontStyle: "italic",
    }),
    rule(["keyword", "storage", "storage.type", "keyword.control"], { foreground: CLAY }),
    rule(["string", "string.quoted", "constant.other.symbol"], { foreground: "#5b7a3f" }),
    rule(["constant.numeric", "constant.language", "constant.character"], { foreground: "#9a5b2e" }),
    rule(["entity.name.function", "support.function", "meta.function-call"], {
      foreground: "#2f6e8f",
    }),
    rule(["entity.name.type", "entity.name.class", "support.type", "support.class"], {
      foreground: "#8b5a7e",
    }),
    rule(["variable", "variable.other", "meta.definition.variable"], { foreground: INK }),
    rule(["variable.parameter"], { foreground: "#7a6a52" }),
    rule(["punctuation", "meta.brace", "keyword.operator"], { foreground: INK_SOFT }),
    rule(["entity.name.tag", "support.type.property-name"], { foreground: CLAY }),
    rule(["entity.other.attribute-name"], { foreground: "#9a5b2e" }),
    rule(["markup.heading", "entity.name.section"], { foreground: CLAY, fontStyle: "bold" }),
    rule(["markup.inline.raw", "markup.fenced_code"], { foreground: "#5b7a3f" }),
    rule(["markup.underline.link", "string.other.link"], { foreground: "#2f6e8f" }),
    rule(["invalid", "invalid.illegal"], { foreground: "#b3462f" }),
  ],
};

export const claudeDark: ThemeRegistration = {
  name: "claude-dark",
  type: "dark",
  colors: {
    "editor.background": NIGHT,
    "editor.foreground": CREAM,
    "editorGroupHeader.tabsBackground": NIGHT_2,
    "list.activeSelectionBackground": NIGHT_3,
    "panel.border": RULE_DARK,
    "editorGroup.border": RULE_DARK,
    "editorLineNumber.foreground": "#6e6a61",
    "textLink.foreground": CLAY_LIGHT,
    "editorGutter.addedBackground": "#6e9455",
    "editorGutter.deletedBackground": "#d0705a",
  },
  tokenColors: [
    rule(["comment", "punctuation.definition.comment"], {
      foreground: "#7e7a70",
      fontStyle: "italic",
    }),
    rule(["keyword", "storage", "storage.type", "keyword.control"], { foreground: CLAY_LIGHT }),
    rule(["string", "string.quoted", "constant.other.symbol"], { foreground: "#a9c085" }),
    rule(["constant.numeric", "constant.language", "constant.character"], { foreground: "#e0a860" }),
    rule(["entity.name.function", "support.function", "meta.function-call"], {
      foreground: "#82b4ce",
    }),
    rule(["entity.name.type", "entity.name.class", "support.type", "support.class"], {
      foreground: "#c79bc0",
    }),
    rule(["variable", "variable.other", "meta.definition.variable"], { foreground: CREAM }),
    rule(["variable.parameter"], { foreground: "#cfc7b4" }),
    rule(["punctuation", "meta.brace", "keyword.operator"], { foreground: CREAM_SOFT }),
    rule(["entity.name.tag", "support.type.property-name"], { foreground: CLAY_LIGHT }),
    rule(["entity.other.attribute-name"], { foreground: "#e0a860" }),
    rule(["markup.heading", "entity.name.section"], { foreground: CLAY_LIGHT, fontStyle: "bold" }),
    rule(["markup.inline.raw", "markup.fenced_code"], { foreground: "#a9c085" }),
    rule(["markup.underline.link", "string.other.link"], { foreground: "#82b4ce" }),
    rule(["invalid", "invalid.illegal"], { foreground: "#d0705a" }),
  ],
};

/** Themes this app ships itself, by the name Shiki will know them under. */
export const CUSTOM_THEMES: Readonly<Record<string, ThemeRegistration>> = {
  "claude-light": claudeLight,
  "claude-dark": claudeDark,
};
