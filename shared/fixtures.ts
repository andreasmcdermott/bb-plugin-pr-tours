import { parseUnifiedDiff } from "./diff.ts";
import {
  TourSchema,
  emptyDraft,
  type Draft,
  type GitHubUser,
  type PrMeta,
  type RevisionMeta,
  type Tour,
  type TourMeta,
} from "./schema.ts";

export const fixturePatch = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
@@ -20,2 +20,3 @@
 last();
+added();
 end();
diff --git a/logo.png b/logo.png
Binary files a/logo.png and b/logo.png differ
`;

export const fixtureFiles = parseUnifiedDiff(fixturePatch);

export const fixturePr: PrMeta = {
  owner: "useshortcut",
  repo: "monorepo",
  number: 42,
  url: "https://github.com/useshortcut/monorepo/pull/42",
  title: "Change b",
  body: "",
  author: "someone-else",
  baseRef: "main",
  headRef: "feature",
  mergeBaseSha: "base000",
  headSha: "head111",
  preparedAt: "2026-09-25T12:00:00.000Z",
};

export function fixtureTour(overrides: Partial<Tour> = {}): Tour {
  return TourSchema.parse({
    version: 1,
    headSha: "head111",
    summary: "Changes b and adds a call.",
    requirements: [{ id: "R1", text: "b is 3", status: "met" }],
    sections: [
      {
        id: "core",
        title: "Core change",
        narrative: "Why b changes.",
        hunks: [
          {
            ref: "src/app.ts#1",
            note: "b goes to 3",
            why: { kind: "requirement", requirements: ["R1"] },
          },
          { ref: "src/app.ts#2", note: "new call", why: { kind: "mechanical" } },
        ],
        findings: [
          {
            id: "f-line",
            severity: "minor",
            title: "Name the constant",
            body: "Magic number.",
            anchor: { path: "src/app.ts", line: 2 },
            suggestion: "const B = 3;",
          },
          {
            id: "f-outside",
            severity: "question",
            title: "Other callers?",
            body: "Does anything else read b?",
            anchor: { path: "src/app.ts", line: 10 },
          },
        ],
      },
      {
        id: "assets",
        title: "Assets",
        narrative: "",
        hunks: [
          { ref: "logo.png", note: "new logo", why: { kind: "supporting", supports: ["core"] } },
        ],
      },
    ],
    ...overrides,
  });
}

export const tourAuthor: GitHubUser = { login: "andreasmcdermott", id: 1001 };
export const otherReviewer: GitHubUser = { login: "teammate", id: 2002 };

export const fixtureMeta: TourMeta = {
  id: "claude-opus-5-5-head111",
  author: tourAuthor,
  model: "claude-opus-5-5",
  agent: "claude-code",
  createdAt: "2026-09-25T12:30:00.000Z",
};

export function fixtureDraft(overrides: Partial<Draft> = {}): Draft {
  return { ...emptyDraft("head111"), ...overrides };
}

export const fixturePatchR2 = fixturePatch.replace("+added();", "+addedAgain();");
export const fixtureFilesR2 = parseUnifiedDiff(fixturePatchR2);
export const fixturePrR2: PrMeta = { ...fixturePr, headSha: "head222" };

export function fixtureTourR2(): Tour {
  const tour = fixtureTour({ headSha: "head222" });
  const [core] = tour.sections;
  core!.hunks[1]!.note = "renamed call";
  core!.findings = core!.findings.filter((finding) => finding.id === "f-line");
  tour.followUp = [
    {
      finding: "f-outside",
      status: "resolved",
      note: "The call was renamed.",
      refs: ["src/app.ts#2"],
    },
  ];
  return tour;
}

export function fixtureRevisionMeta(revision: number, headSha: string): RevisionMeta {
  return {
    revision,
    headSha,
    model: "claude-opus-5-5",
    agent: "claude-code",
    createdAt: `2026-09-2${4 + revision}T12:30:00.000Z`,
  };
}
