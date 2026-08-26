import { createHighlighter, type BundledLanguage, type Highlighter, type ThemedToken } from "shiki";

/** One highlighter for the whole app: loading grammars twice is wasteful. */

export type { ThemedToken };

const THEME_LIGHT = "github-light";
const THEME_DARK = "github-dark";

const LANGS = [
  "go", "typescript", "tsx", "javascript", "json", "yaml",
  "markdown", "hcl", "sql", "php", "python", "bash",
] as const;

const BY_EXTENSION: Readonly<Record<string, BundledLanguage>> = {
  go: "go", ts: "typescript", tsx: "tsx", js: "javascript", jsx: "tsx",
  json: "json", yaml: "yaml", yml: "yaml", md: "markdown", mdx: "markdown",
  tf: "hcl", sql: "sql", php: "php", py: "python", sh: "bash",
};

let promise: Promise<Highlighter> | null = null;

export const getHighlighter = (): Promise<Highlighter> =>
  (promise ??= createHighlighter({ themes: [THEME_LIGHT, THEME_DARK], langs: [...LANGS] }));

export const langFor = (path: string): BundledLanguage | null =>
  BY_EXTENSION[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? null;

export const currentTheme = (): string =>
  typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
    ? THEME_DARK
    : THEME_LIGHT;

/** Tokenise a block of source, falling back to plain rows if anything fails. */
export async function tokenise(
  code: string,
  path: string,
): Promise<readonly (readonly ThemedToken[])[]> {
  try {
    const highlighter = await getHighlighter();
    const lang = langFor(path);
    const known = lang !== null && highlighter.getLoadedLanguages().includes(lang);
    const { tokens } = highlighter.codeToTokens(code, {
      lang: known ? lang : "text",
      theme: currentTheme(),
    });
    return tokens;
  } catch {
    // Highlighting is decoration: plain rows beat a blank pane.
    return code.split("\n").map((line) => [{ content: line } as ThemedToken]);
  }
}
