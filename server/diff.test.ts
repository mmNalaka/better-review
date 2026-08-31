import { describe, expect, test } from "bun:test";

import { parseUnifiedDiff, splitDiffByFile } from "./diff";

/** Real `git diff` output shapes, trimmed to the parts the splitter reads. */
const TWO_FILES = `diff --git a/app/constants.go b/app/constants.go
index 1111111..2222222 100644
--- a/app/constants.go
+++ b/app/constants.go
@@ -10,3 +10,4 @@ const (
 	A = 1
-	B = 2
+	B = 3
+	C = 4
diff --git a/service/scim.go b/service/scim.go
index 3333333..4444444 100644
--- a/service/scim.go
+++ b/service/scim.go
@@ -44,2 +44,2 @@ func assignScope(
-	old()
+	new()
@@ -90,1 +90,2 @@
+	extra()
`;

describe("splitDiffByFile", () => {
  test("keys hunks by head-side path", () => {
    const byFile = splitDiffByFile(TWO_FILES);
    expect([...byFile.keys()]).toEqual(["app/constants.go", "service/scim.go"]);
    expect(byFile.get("service/scim.go")?.hunks).toHaveLength(2);
  });

  test("gives every hunk the same id the single-file parser would", () => {
    const byFile = splitDiffByFile(TWO_FILES);
    const first = byFile.get("service/scim.go")?.hunks[0];
    const alone = parseUnifiedDiff("@@ -44,2 +44,2 @@ func assignScope(\n-\told()\n+\tnew()\n").hunks[0];
    expect(first?.id).toBe(alone!.id);
    expect(first?.header).toContain("func assignScope(");
  });

  test("uses the base-side path for a deletion", () => {
    const patch = `diff --git a/gone.go b/gone.go
deleted file mode 100644
index 5555555..0000000
--- a/gone.go
+++ /dev/null
@@ -1,2 +0,0 @@
-	one()
-	two()
`;
    expect([...splitDiffByFile(patch).keys()]).toEqual(["gone.go"]);
  });

  test("keeps a rename's destination path", () => {
    const patch = `diff --git a/old/name.go b/new/name.go
similarity index 95%
rename from old/name.go
rename to new/name.go
index 6666666..7777777 100644
--- a/old/name.go
+++ b/new/name.go
@@ -1,1 +1,1 @@
-	a()
+	b()
`;
    expect([...splitDiffByFile(patch).keys()]).toEqual(["new/name.go"]);
  });

  test("marks a binary file rather than inventing hunks for it", () => {
    const patch = `diff --git a/logo.png b/logo.png
index 8888888..9999999 100644
Binary files a/logo.png and b/logo.png differ
`;
    const entry = splitDiffByFile(patch).get("logo.png");
    expect(entry?.binary).toBe(true);
    expect(entry?.hunks).toEqual([]);
  });

  test("handles a path containing a space", () => {
    const patch = `diff --git a/docs/my notes.md b/docs/my notes.md
index aaaaaaa..bbbbbbb 100644
--- a/docs/my notes.md	
+++ b/docs/my notes.md	
@@ -1,1 +1,1 @@
-a
+b
`;
    expect([...splitDiffByFile(patch).keys()]).toEqual(["docs/my notes.md"]);
  });

  test("is empty for an empty patch", () => {
    expect(splitDiffByFile("").size).toBe(0);
  });
});
