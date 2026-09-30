import { describe, expect, test } from "bun:test";
import { coverageUnits, findHunkForLine, parseUnifiedDiff } from "./diff.ts";

const modified = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,4 @@ export function app() {
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
 const d = 5;
@@ -20,2 +20,3 @@
 last();
+added();
 end();
`;

describe("parseUnifiedDiff", () => {
  test("numbers lines on both sides and gives hunks stable ids", () => {
    const [file] = parseUnifiedDiff(modified);
    expect(file).toMatchObject({
      path: "src/app.ts",
      oldPath: null,
      status: "modified",
      binary: false,
    });
    expect(file!.hunks.map((h) => h.id)).toEqual(["src/app.ts#1", "src/app.ts#2"]);
    expect(file!.hunks[0]!.lines).toEqual([
      { kind: "context", oldLine: 1, newLine: 1, text: "const a = 1;" },
      { kind: "del", oldLine: 2, newLine: null, text: "const b = 2;" },
      { kind: "add", oldLine: null, newLine: 2, text: "const b = 3;" },
      { kind: "context", oldLine: 3, newLine: 3, text: "const c = 4;" },
      { kind: "context", oldLine: 4, newLine: 4, text: "const d = 5;" },
    ]);
    expect(file!.hunks[1]!.lines.map((l) => [l.kind, l.oldLine, l.newLine])).toEqual([
      ["context", 20, 20],
      ["add", null, 21],
      ["context", 21, 22],
    ]);
  });

  test("uses hunk line counts so deleted '--' lines are not read as file headers", () => {
    const patch = `diff --git a/q.sql b/q.sql
--- a/q.sql
+++ b/q.sql
@@ -1,2 +1,2 @@
--- a comment
+++ another
 select 1;
`;
    const [file] = parseUnifiedDiff(patch);
    expect(file!.path).toBe("q.sql");
    expect(file!.hunks[0]!.lines.map((l) => [l.kind, l.text])).toEqual([
      ["del", "-- a comment"],
      ["add", "++ another"],
      ["context", "select 1;"],
    ]);
  });

  test("defaults omitted hunk counts to one", () => {
    const patch = `diff --git a/one b/one
--- a/one
+++ b/one
@@ -3 +3 @@
-old
+new
`;
    const [file] = parseUnifiedDiff(patch);
    expect(file!.hunks[0]).toMatchObject({ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1 });
    expect(file!.hunks[0]!.lines).toHaveLength(2);
  });

  test("detects added, deleted, renamed, and binary files", () => {
    const patch = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,1 @@
+export {};
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-export {};
diff --git a/old/name.ts b/new/name.ts
similarity index 100%
rename from old/name.ts
rename to new/name.ts
diff --git a/logo.png b/logo.png
Binary files a/logo.png and b/logo.png differ
`;
    const files = parseUnifiedDiff(patch);
    expect(files.map((f) => [f.path, f.oldPath, f.status, f.binary])).toEqual([
      ["new.ts", null, "added", false],
      ["gone.ts", "gone.ts", "deleted", false],
      ["new/name.ts", "old/name.ts", "renamed", false],
      ["logo.png", null, "modified", true],
    ]);
    expect(coverageUnits(files)).toEqual(["new.ts#1", "gone.ts#1", "new/name.ts", "logo.png"]);
  });

  test("records a missing newline at end of file", () => {
    const patch = `diff --git a/a b/a
--- a/a
+++ b/a
@@ -1 +1 @@
-x
\\ No newline at end of file
+y
\\ No newline at end of file
`;
    const lines = parseUnifiedDiff(patch)[0]!.hunks[0]!.lines;
    expect(lines.map((l) => [l.kind, l.noNewlineAtEnd ?? false])).toEqual([
      ["del", true],
      ["add", true],
    ]);
  });

  // Real `git diff` output: git ends a header path that contains a space with a
  // tab, and C-quotes paths with special characters.
  test("reads paths with spaces, quotes, tabs, and non-ASCII characters", () => {
    const patch = `diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"
new file mode 100644
--- /dev/null
+++ "b/caf\\303\\251.txt"
@@ -0,0 +1 @@
+y
diff --git a/my file.txt b/my file.txt
new file mode 100644
--- /dev/null
+++ b/my file.txt\t
@@ -0,0 +1 @@
+a
diff --git "a/say \\"hi\\".txt" "b/say \\"hi\\".txt"
new file mode 100644
--- /dev/null
+++ "b/say \\"hi\\".txt"\t
@@ -0,0 +1 @@
+z
diff --git "a/tab\\tname.txt" "b/tab\\tname.txt"
new file mode 100644
--- /dev/null
+++ "b/tab\\tname.txt"
@@ -0,0 +1 @@
+x
diff --git a/logo 2.png b/logo 2.png
new file mode 100644
Binary files /dev/null and b/logo 2.png differ
diff --git a/my file.txt "b/new na\\303\\257ve.txt"
similarity index 100%
rename from my file.txt
rename to "new na\\303\\257ve.txt"
`;
    const files = parseUnifiedDiff(patch);
    expect(files.map((f) => [f.path, f.oldPath])).toEqual([
      ["café.txt", null],
      ["my file.txt", null],
      ['say "hi".txt', null],
      ["tab\tname.txt", null],
      ["logo 2.png", null],
      ["new naïve.txt", "my file.txt"],
    ]);
    expect(coverageUnits(files)).toEqual([
      "café.txt#1",
      "my file.txt#1",
      'say "hi".txt#1',
      "tab\tname.txt#1",
      "logo 2.png",
      "new naïve.txt",
    ]);
  });
});

describe("findHunkForLine", () => {
  const [file] = parseUnifiedDiff(modified);

  test("finds added and context lines on the RIGHT and deleted lines on the LEFT", () => {
    expect(findHunkForLine(file!, "RIGHT", 2)?.hunk.id).toBe("src/app.ts#1");
    expect(findHunkForLine(file!, "LEFT", 2)?.hunk.id).toBe("src/app.ts#1");
    expect(findHunkForLine(file!, "RIGHT", 22)?.hunk.id).toBe("src/app.ts#2");
  });

  test("returns null for lines outside every hunk", () => {
    expect(findHunkForLine(file!, "RIGHT", 10)).toBeNull();
    expect(findHunkForLine(file!, "LEFT", 22)).toBeNull();
  });
});
