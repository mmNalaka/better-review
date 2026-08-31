import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { resolveAsset } from "./static";

const ROOT = "/srv/better-review/web/dist";

describe("resolveAsset", () => {
  test("serves the page itself at the root", () => {
    expect(resolveAsset(ROOT, "/")).toBe(join(ROOT, "index.html"));
  });

  test("serves a built asset", () => {
    expect(resolveAsset(ROOT, "/assets/app-a1b2c3.js")).toBe(join(ROOT, "assets/app-a1b2c3.js"));
  });

  test("decodes a percent-encoded name", () => {
    expect(resolveAsset(ROOT, "/assets/my%20file.css")).toBe(join(ROOT, "assets/my file.css"));
  });

  /**
   * Parent segments do not escape: `normalize` clamps them at the root of the
   * path, so they land somewhere harmless inside the build directory and 404.
   * What matters is not that they are refused but that they cannot get out.
   */
  test.each([
    ["a parent segment", "/../../etc/passwd"],
    ["a parent segment mid-path", "/assets/../../../etc/passwd"],
    ["an encoded parent segment", "/%2e%2e/%2e%2e/etc/passwd"],
    ["a doubly encoded one", "/%252e%252e/etc/passwd"],
  ])("cannot escape the root with %s", (_name, path) => {
    const resolved = resolveAsset(ROOT, path);
    expect(resolved === null || resolved.startsWith(ROOT + "/")).toBe(true);
  });

  test("refuses a null byte", () => {
    expect(resolveAsset(ROOT, "/assets/app.js%00.png")).toBeNull();
  });

  test("refuses malformed encoding rather than guessing", () => {
    expect(resolveAsset(ROOT, "/%zz")).toBeNull();
  });

  test("keeps a name that merely looks like an escape", () => {
    // "..." is a legal file name; only real parent segments escape.
    expect(resolveAsset(ROOT, "/assets/.../x.js")).toBe(join(ROOT, "assets/.../x.js"));
  });

  test("collapses a doubled slash rather than treating it as an absolute path", () => {
    expect(resolveAsset(ROOT, "//etc/passwd")).toBe(join(ROOT, "etc/passwd"));
  });

  test("a directory path asks for its index", () => {
    expect(resolveAsset(ROOT, "/sub/")).toBe(join(ROOT, "sub/index.html"));
  });
});
