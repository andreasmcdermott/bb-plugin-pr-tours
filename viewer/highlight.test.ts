import { describe, expect, test } from "bun:test";
import { parseUnifiedDiff } from "../shared/diff.ts";
import { highlightHunk, highlightLines, languageFor, type Token } from "./highlight.ts";

const COMMENT = "#6A737D";

const text = (tokens: Token[]) => tokens.map((token) => token.content).join("");

describe("languageFor", () => {
  test("maps the file types this repo uses", () => {
    expect(languageFor("korey-frontend/src/App.tsx")).toBe("tsx");
    expect(languageFor("backend/src/clubhouse/projects.clj")).toBe("clojure");
    expect(languageFor("infrastructure/main.tf")).toBe("terraform");
    expect(languageFor("services/api/Dockerfile")).toBe("docker");
    expect(languageFor("LICENSE")).toBeNull();
    expect(languageFor("logo.png")).toBeNull();
  });
});

describe("highlightHunk", () => {
  const [file] = parseUnifiedDiff(`diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
-/* removed
+const x = 1;
 still();
 end();
`);
  const hunk = file!.hunks[0]!;
  const lines = highlightHunk("src/a.ts", hunk);

  test("keeps every line's text intact", () => {
    expect(lines.map(text)).toEqual(hunk.lines.map((line) => line.text));
  });

  test("colors each side on its own", () => {
    expect(lines[0]!.every((token) => token.color === COMMENT)).toBe(true);
    expect(lines[2]!.find((token) => token.content === "still")?.color).not.toBe(COMMENT);
  });

  test("leaves unknown file types plain", () => {
    expect(highlightLines("notes.unknown", ["a", ""])).toEqual([
      [{ content: "a" }],
      [{ content: "" }],
    ]);
  });
});
