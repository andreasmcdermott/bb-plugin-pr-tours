import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fixtureDraft, fixturePatch, fixtureTour, tourAuthor } from "../shared/fixtures.ts";
import { fakeGh } from "./fake-gh.ts";
import { formatOutline, formatTours, prepare } from "./prepare.ts";
import { draftFile, listTours } from "./review-dir.ts";
import { writeTourRevision } from "./test-review.ts";

const pull = (headSha: string) =>
  JSON.stringify({
    html_url: "https://github.com/useshortcut/monorepo/pull/42",
    title: "Change b",
    body: null,
    user: { login: "someone-else" },
    changed_files: 2,
    base: { ref: "main", sha: "base-tip" },
    head: { ref: "feature", sha: headSha },
  });

function ghFor(headSha: string) {
  const repo = "repos/useshortcut/monorepo";
  return fakeGh({
    [`api ${repo}/pulls/42`]: pull(headSha),
    [`api -H Accept: application/vnd.github.diff ${repo}/compare/base-tip...${headSha}`]:
      fixturePatch,
    [`api ${repo}/compare/base-tip...${headSha} --jq .merge_base_commit.sha`]: "merge-base\n",
  });
}

let dir: string;
beforeEach(() => {
  dir = path.join(mkdtempSync(path.join(tmpdir(), "pr-tour-")), "review");
});

describe("prepare", () => {
  test("pins the diff to the PR head and writes the review directory", async () => {
    const result = await prepare({
      gh: ghFor("head111"),
      ref: "useshortcut/monorepo#42",
      dir,
      now: () => new Date("2026-09-25T12:00:00Z"),
    });
    expect(result.warnings).toEqual([]);
    expect(result.pr).toMatchObject({ headSha: "head111", mergeBaseSha: "merge-base", body: "" });
    expect(JSON.parse(readFileSync(path.join(dir, "pr.json"), "utf8")).headSha).toBe("head111");
    expect(readFileSync(path.join(dir, "diff.patch"), "utf8")).toBe(fixturePatch);
    expect(formatOutline(result.files)).toBe(
      [
        "  src/app.ts#1  @@ -1,3 +1,3 @@  +1 -1",
        "  src/app.ts#2  @@ -20,2 +20,3 @@  +1 -0",
        "  logo.png  (binary)",
      ].join("\n"),
    );
  });

  test("points at revise for tours written for an older commit, and keeps their drafts", async () => {
    await prepare({ gh: ghFor("head111"), ref: "useshortcut/monorepo#42", dir });
    const revisionDir = writeTourRevision(dir, { tour: fixtureTour(), draft: fixtureDraft() });

    const result = await prepare({ gh: ghFor("head222"), ref: "useshortcut/monorepo#42", dir });
    expect(result.warnings).toEqual([
      `tour claude-opus-5-5-head111 r1 was written for head111; run \`pr-tour revise ${dir} --tour claude-opus-5-5-head111\` to review the new commits`,
    ]);
    expect(readFileSync(draftFile(revisionDir, tourAuthor), "utf8")).toContain("head111");
    expect(JSON.parse(readFileSync(path.join(revisionDir, "pr.json"), "utf8")).headSha).toBe(
      "head111",
    );
    expect(formatTours(listTours(dir), result.pr.headSha)).toBe(
      "  claude-opus-5-5-head111 r1  claude-opus-5-5 via claude-code, by andreasmcdermott at 2026-09-25T12:30:00.000Z  (outdated, written for head111)",
    );
  });

  test("warns when the diff has fewer files than GitHub reports", async () => {
    const patchOnly = fixturePatch.split("diff --git a/logo.png")[0]!;
    const repo = "repos/useshortcut/monorepo";
    const truncated = fakeGh({
      [`api ${repo}/pulls/42`]: pull("head111"),
      [`api -H Accept: application/vnd.github.diff ${repo}/compare/base-tip...head111`]: patchOnly,
      [`api ${repo}/compare/base-tip...head111 --jq .merge_base_commit.sha`]: "merge-base",
    });
    const result = await prepare({ gh: truncated, ref: "useshortcut/monorepo#42", dir });
    expect(result.warnings).toEqual([
      "GitHub reports 2 changed files but the diff has 1; the diff may be truncated",
    ]);
  });
});
