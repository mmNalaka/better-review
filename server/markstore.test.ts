import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

import { emptyMarkFile, MarkError, noteKey } from "./markmodel";
import { marksPath, readMarks, writeMarks } from "./markstore";

const PR = { owner: "sitoo", repo: "auth", number: 146 } as const;

const dirs: string[] = [];
const scratch = async () => {
  const dir = await mkdtemp(join(tmpdir(), "br-marks-"));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const KEY = noteKey("service/scim.go", "e08ea6d1ada2d07c", 3);

const withMark = (body: string) => ({
  ...emptyMarkFile(PR),
  notes: {
    [KEY]: {
      path: "service/scim.go",
      hunkId: "e08ea6d1ada2d07c",
      lineIndex: 3,
      lineText: "\tnew()",
      endLineIndex: null,
      endLineText: null,
      body,
      updatedAt: "2026-08-27T09:00:00.000Z",
      published: null,
    },
  },
});

describe("marksPath", () => {
  test("is one file per pull request", () => {
    expect(basename(marksPath("/data", PR))).toBe("sitoo__auth__146.json");
  });

  test("refuses a name that could escape the directory", () => {
    expect(() => marksPath("/data", { ...PR, owner: "../../etc" })).toThrow(MarkError);
    expect(() => marksPath("/data", { ...PR, repo: "a/b" })).toThrow(MarkError);
  });
});

describe("readMarks", () => {
  test("returns an empty file when nothing has been saved", async () => {
    expect(await readMarks(await scratch(), PR)).toEqual(emptyMarkFile(PR));
  });

  test("surfaces a corrupt file rather than starting silently empty", async () => {
    const dir = await scratch();
    await writeFile(marksPath(dir, PR), "{ not json");
    expect(readMarks(dir, PR)).rejects.toThrow(MarkError);
  });

  test("surfaces a file whose contents are for another pull request", async () => {
    const dir = await scratch();
    await writeFile(marksPath(dir, PR), JSON.stringify(emptyMarkFile({ ...PR, number: 999 })));
    expect(readMarks(dir, PR)).rejects.toThrow(MarkError);
  });
});

describe("writeMarks", () => {
  test("round-trips", async () => {
    const dir = await scratch();
    await writeMarks(dir, PR, withMark("ordering?"));
    expect(await readMarks(dir, PR)).toEqual(withMark("ordering?"));
  });

  test("creates the directory it needs", async () => {
    const dir = join(await scratch(), "nested", "marks");
    await writeMarks(dir, PR, withMark("ordering?"));
    expect(await readMarks(dir, PR)).toEqual(withMark("ordering?"));
  });

  test("replaces the previous save and leaves no temporary file behind", async () => {
    const dir = await scratch();
    await writeMarks(dir, PR, withMark("first"));
    await writeMarks(dir, PR, withMark("second"));

    expect((await readMarks(dir, PR)).notes[KEY]?.body).toBe("second");
    expect(await readdir(dir)).toEqual(["sitoo__auth__146.json"]);
  });

  test("validates before it writes, so a bad payload cannot land on disk", async () => {
    const dir = await scratch();
    const bad = { ...emptyMarkFile(PR), notes: { "wrong@key#1": { path: "a", hunkId: "b" } } };
    expect(writeMarks(dir, PR, bad as never)).rejects.toThrow(MarkError);
    expect(await readdir(dir)).toEqual([]);
  });

  test("survives concurrent writes without corrupting the file", async () => {
    const dir = await scratch();
    await Promise.all([
      writeMarks(dir, PR, withMark("a")),
      writeMarks(dir, PR, withMark("b")),
      writeMarks(dir, PR, withMark("c")),
    ]);
    // Whichever won, the file is whole and readable.
    const body = (await readMarks(dir, PR)).notes[KEY]?.body;
    expect(["a", "b", "c"]).toContain(body!);
    expect(await readdir(dir)).toEqual(["sitoo__auth__146.json"]);
  });
});
