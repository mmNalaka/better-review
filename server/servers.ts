import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where each language server lives. Ticket 01 settled *which* servers:
 * `tsc --lsp` from TypeScript 7 (the native Go port) rather than
 * typescript-language-server, and gopls for Go.
 */

export type LanguageId =
  | "typescript"
  | "typescriptreact"
  | "javascript"
  | "go"
  | "python"
  | "terraform";

export interface ServerSpec {
  readonly command: string;
  readonly args: readonly string[];
  /** Servers are pooled per repo under this key, so TS and TSX share one. */
  readonly pool: string;
}

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, LanguageId>> = {
  ts: "typescript", mts: "typescript", cts: "typescript",
  tsx: "typescriptreact",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  go: "go",
  py: "python", pyi: "python",
  tf: "terraform", tfvars: "terraform",
};

/**
 * Ticket 11: TypeScript and Go are the supported tier — 153 of 209 files across
 * the sampled PRs, and both verified. The rest are registered so they light up
 * if their binary happens to be present, and honestly report `not applicable`
 * when it is not. Highlighting is unaffected either way.
 */
const INSTALL_HINT: Readonly<Record<LanguageId, string>> = {
  go: "install gopls with `go install golang.org/x/tools/gopls@latest`, or set BR_GOPLS",
  typescript: "run `bun install`, or set BR_TSGO",
  typescriptreact: "run `bun install`, or set BR_TSGO",
  javascript: "run `bun install`, or set BR_TSGO",
  python: "install pyright with `pip install pyright`, or set BR_PYRIGHT",
  terraform: "install terraform-ls, or set BR_TERRAFORM_LS",
};

export const languageOf = (path: string): LanguageId | null =>
  LANGUAGE_BY_EXTENSION[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? null;

const executable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const first = (candidates: readonly string[]): string | null =>
  candidates.find(executable) ?? null;

/** The tsgo binary ships in a platform-specific optional dependency. */
function findTsgo(): string | null {
  const platform = `${process.platform}-${process.arch}`;
  return first([
    join(process.cwd(), "node_modules", "@typescript", `typescript-${platform}`, "lib", "tsc"),
    process.env.BR_TSGO ?? "",
  ]);
}

function onPath(name: string): string | null {
  const dirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  return first(dirs.map((dir) => join(dir, name)));
}

function findGopls(): string | null {
  const gopath = process.env.GOPATH ?? join(homedir(), "go");
  return first([process.env.BR_GOPLS ?? "", join(gopath, "bin", "gopls")]) ?? onPath("gopls");
}

export function specFor(language: LanguageId): ServerSpec | null {
  switch (language) {
    case "go": {
      const command = findGopls();
      return command ? { command, args: [], pool: "go" } : null;
    }
    case "python": {
      const command = first([process.env.BR_PYRIGHT ?? ""]) ?? onPath("pyright-langserver");
      return command ? { command, args: ["--stdio"], pool: "python" } : null;
    }
    case "terraform": {
      const command = first([process.env.BR_TERRAFORM_LS ?? ""]) ?? onPath("terraform-ls");
      return command ? { command, args: ["serve"], pool: "terraform" } : null;
    }
    default: {
      const command = findTsgo();
      return command ? { command, args: ["--lsp", "--stdio"], pool: "typescript" } : null;
    }
  }
}

export function missingServerMessage(language: LanguageId): string {
  return `No ${language} language server found — ${INSTALL_HINT[language]}.`;
}
