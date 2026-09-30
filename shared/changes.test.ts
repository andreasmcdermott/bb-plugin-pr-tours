import { describe, expect, test } from "bun:test";
import { computeChanges, seedViewedSections, unchangedSections } from "./changes.ts";
import { parseUnifiedDiff } from "./diff.ts";
import {
  fixtureDraft,
  fixtureFiles,
  fixtureFilesR2,
  fixturePatch,
  fixtureTour,
  fixtureTourR2,
} from "./fixtures.ts";

const r1 = { revision: 1, headSha: "head111", files: fixtureFiles };
const r2 = { revision: 2, headSha: "head222", files: fixtureFilesR2 };

describe("computeChanges", () => {
  test("carries hunks whose changed lines are the same and flags the rest", () => {
    expect(computeChanges(r1, r2)).toEqual({
      from: { revision: 1, headSha: "head111" },
      to: { revision: 2, headSha: "head222" },
      carried: [{ ref: "src/app.ts#1", previous: "src/app.ts#1" }],
      changed: ["src/app.ts#2", "logo.png"],
      dropped: ["src/app.ts#2", "logo.png"],
    });
  });

  test("ignores moved line numbers and new hunks around an unchanged one", () => {
    const rebased = parseUnifiedDiff(
      fixturePatch
        .replace("@@ -1,3 +1,3 @@", "@@ -1,1 +1,2 @@\n top();\n+inserted();\n@@ -5,3 +6,3 @@")
        .replace("@@ -20,2 +20,3 @@", "@@ -40,2 +41,3 @@"),
    );
    const changes = computeChanges(r1, { revision: 2, headSha: "head222", files: rebased });
    expect(changes.carried).toEqual([
      { ref: "src/app.ts#2", previous: "src/app.ts#1" },
      { ref: "src/app.ts#3", previous: "src/app.ts#2" },
    ]);
    expect(changes.changed).toEqual(["src/app.ts#1", "logo.png"]);
    expect(changes.dropped).toEqual(["logo.png"]);
  });
});

describe("sections that did not change", () => {
  const changes = computeChanges(r1, r2);

  test("are those whose hunks and findings all carried over", () => {
    const tour = fixtureTourR2();
    tour.sections.push({
      id: "same",
      title: "Same",
      narrative: "",
      hunks: tour.sections[0]!.hunks.splice(0, 1),
      findings: [],
    });
    expect([...unchangedSections(tour, changes, fixtureTour())]).toEqual(["same"]);

    tour.sections.at(-1)!.findings.push({ ...tour.sections[0]!.findings[0]!, id: "new" });
    expect([...unchangedSections(tour, changes, fixtureTour())]).toEqual([]);
  });

  test("stay viewed when the reviewer viewed every hunk in them last time", () => {
    const tour = fixtureTourR2();
    tour.sections.push({
      id: "same",
      title: "Same",
      narrative: "",
      hunks: tour.sections[0]!.hunks.splice(0, 1),
      findings: [],
    });
    const previous = (viewedSections: string[]) => ({
      tour: fixtureTour(),
      draft: fixtureDraft({ viewedSections }),
    });
    expect(seedViewedSections(tour, changes, previous(["core"]))).toEqual(["same"]);
    expect(seedViewedSections(tour, changes, previous(["assets"]))).toEqual([]);
  });
});
