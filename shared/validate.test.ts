import { describe, expect, test } from "bun:test";
import { computeChanges } from "./changes.ts";
import {
  fixtureFiles,
  fixtureFilesR2,
  fixturePr,
  fixturePrR2,
  fixtureTour,
  fixtureTourR2,
} from "./fixtures.ts";
import type { Tour } from "./schema.ts";
import { resolveAnchor, validateTour } from "./validate.ts";

describe("validateTour", () => {
  test("accepts a tour that covers every hunk once", () => {
    const result = validateTour(fixtureTour(), fixturePr, fixtureFiles);
    expect(result.errors).toEqual([]);
    expect(result.uncovered).toEqual([]);
    expect(result.warnings).toEqual([
      'finding "f-outside": line 10 (RIGHT) is outside the diff; it will be posted in the review body',
    ]);
  });

  test("reports hunks no section covers", () => {
    const tour = fixtureTour();
    tour.sections[0]!.hunks.pop();
    const result = validateTour(tour, fixturePr, fixtureFiles);
    expect(result.uncovered).toEqual(["src/app.ts#2"]);
    expect(result.errors).toContain('hunk "src/app.ts#2" is not covered by any section');
  });

  test("rejects unknown and duplicated refs", () => {
    const tour = fixtureTour();
    tour.sections[1]!.hunks.push(
      { ref: "src/app.ts#1", note: "", why: { kind: "mechanical" }, ranges: [] },
      { ref: "src/app.ts#9", note: "", why: { kind: "mechanical" }, ranges: [] },
    );
    expect(validateTour(tour, fixturePr, fixtureFiles).errors).toEqual([
      'hunk "src/app.ts#1" appears in both "core" and "assets"',
      'section "assets" references unknown hunk "src/app.ts#9"',
    ]);
  });

  test("rejects a tour written against a different head commit", () => {
    const result = validateTour(fixtureTour({ headSha: "stale" }), fixturePr, fixtureFiles);
    expect(result.errors[0]).toStartWith("tour.headSha stale does not match");
  });

  test("rejects suggestions that GitHub cannot apply", () => {
    const tour = fixtureTour();
    tour.sections[0]!.findings[1]!.suggestion = "x";
    tour.sections[0]!.findings.push({
      id: "f-left",
      severity: "nit",
      title: "t",
      body: "",
      anchor: { path: "src/app.ts", line: 2, side: "LEFT" },
      suggestion: "y",
    });
    expect(validateTour(tour, fixturePr, fixtureFiles).errors).toEqual([
      'finding "f-outside": suggestions need a RIGHT-side line that is in the diff',
      'finding "f-left": suggestions need a RIGHT-side line that is in the diff',
    ]);
  });

  test("rejects duplicate ids", () => {
    const tour = fixtureTour();
    tour.requirements.push({ id: "R1", text: "again", status: "unclear" });
    tour.sections[1]!.id = "core";
    tour.sections[1]!.findings.push({ ...tour.sections[0]!.findings[0]!, suggestion: undefined });
    expect(validateTour(tour, fixturePr, fixtureFiles).errors).toEqual([
      'duplicate requirement id "R1"',
      'duplicate section id "core"',
      'duplicate finding id "f-line"',
    ]);
  });
});

describe("why", () => {
  const hunk = (tour: Tour, ref: string) =>
    tour.sections.flatMap((section) => section.hunks).find((h) => h.ref === ref)!;

  test("requirement and supporting whys must point at things that exist", () => {
    const tour = fixtureTour();
    hunk(tour, "src/app.ts#1").why = { kind: "requirement", requirements: ["R1", "R9"] };
    hunk(tour, "src/app.ts#2").why = { kind: "supporting", supports: ["src/app.ts#2", "nope"] };
    hunk(tour, "logo.png").why = { kind: "supporting", supports: ["src/app.ts#1"] };
    expect(validateTour(tour, fixturePr, fixtureFiles).errors).toEqual([
      'hunk "src/app.ts#1" implements unknown requirement "R9"',
      'hunk "src/app.ts#2" cannot support itself',
      'hunk "src/app.ts#2" supports "nope", which is neither a section nor a hunk',
    ]);
  });

  test("an unexplained hunk needs a question anchored inside it", () => {
    const tour = fixtureTour();
    hunk(tour, "src/app.ts#2").why = { kind: "unexplained" };
    hunk(tour, "logo.png").why = { kind: "unexplained" };
    const error = (ref: string) =>
      `hunk "${ref}" is unexplained, so it needs a question finding on one of its lines asking the author why`;
    expect(validateTour(tour, fixturePr, fixtureFiles).errors).toEqual([
      error("src/app.ts#2"),
      error("logo.png"),
    ]);

    const [core, assets] = tour.sections;
    core!.findings.push({
      id: "why-added",
      severity: "minor",
      title: "Why?",
      body: "",
      anchor: { path: "src/app.ts", line: 21, side: "RIGHT" },
    });
    expect(validateTour(tour, fixturePr, fixtureFiles).errors).toContain(error("src/app.ts#2"));

    core!.findings.at(-1)!.severity = "question";
    assets!.findings.push({
      id: "why-logo",
      severity: "question",
      title: "Why a new logo?",
      body: "",
      anchor: { path: "logo.png", side: "RIGHT" },
    });
    expect(validateTour(tour, fixturePr, fixtureFiles).errors).toEqual([]);
  });

  test("a met or partial requirement needs a hunk that implements it", () => {
    const tour = fixtureTour();
    tour.requirements.push(
      { id: "R2", text: "c is 5", status: "partial" },
      { id: "R3", text: "d is 6", status: "unmet" },
    );
    expect(validateTour(tour, fixturePr, fixtureFiles).errors).toEqual([
      'requirement "R2" is partial, but no hunk says it implements it',
    ]);
  });
});

describe("range notes", () => {
  const withRanges = (ref: string, ranges: Tour["sections"][number]["hunks"][number]["ranges"]) => {
    const tour = fixtureTour();
    tour.sections.flatMap((section) => section.hunks).find((h) => h.ref === ref)!.ranges = ranges;
    return validateTour(tour, fixturePr, fixtureFiles).errors;
  };

  test("accepts notes on lines inside their hunk", () => {
    expect(
      withRanges("src/app.ts#2", [
        { startLine: 20, line: 21, side: "RIGHT", note: "the new call" },
        { line: 22, side: "RIGHT", note: "unchanged" },
      ]),
    ).toEqual([]);
    expect(withRanges("src/app.ts#1", [{ line: 2, side: "LEFT", note: "old b" }])).toEqual([]);
  });

  test("rejects notes on lines outside their hunk", () => {
    expect(
      withRanges("src/app.ts#2", [
        { startLine: 1, line: 3, side: "RIGHT", note: "" },
        { startLine: 21, line: 23, side: "RIGHT", note: "" },
        { line: 10, side: "RIGHT", note: "" },
        { startLine: 22, line: 20, side: "RIGHT", note: "" },
      ]),
    ).toEqual([
      'hunk "src/app.ts#2" has a range note on lines 1–3 (RIGHT), which reach outside the hunk',
      'hunk "src/app.ts#2" has a range note on lines 21–23 (RIGHT), which reach outside the hunk',
      'hunk "src/app.ts#2" has a range note on line 10 (RIGHT), which is outside the hunk',
      'hunk "src/app.ts#2" has a range note on lines 22–20 (RIGHT): startLine must be less than line',
    ]);
    expect(withRanges("logo.png", [{ line: 1, side: "RIGHT", note: "" }])).toEqual([
      'hunk "logo.png" has no lines, so it cannot have range notes',
    ]);
  });

  test("rejects notes that overlap", () => {
    expect(
      withRanges("src/app.ts#2", [
        { startLine: 21, line: 22, side: "RIGHT", note: "" },
        { startLine: 20, line: 21, side: "RIGHT", note: "" },
      ]),
    ).toEqual([
      'hunk "src/app.ts#2" has range notes on lines 20–21 (RIGHT) and lines 21–22 (RIGHT) that overlap',
    ]);
  });
});

describe("revisions", () => {
  const previous = {
    tour: fixtureTour(),
    changes: computeChanges(
      { revision: 1, headSha: "head111", files: fixtureFiles },
      { revision: 2, headSha: "head222", files: fixtureFilesR2 },
    ),
  };
  const errors = (tour: Tour) => validateTour(tour, fixturePrR2, fixtureFilesR2, previous).errors;

  test("accepts a revision that accounts for every earlier finding", () => {
    expect(errors(fixtureTourR2())).toEqual([]);
  });

  test("every earlier finding stays open or is followed up exactly once", () => {
    const tour = fixtureTourR2();
    tour.followUp = [];
    expect(errors(tour)).toEqual([
      'finding "f-outside" from revision 1 must stay open in a section with the same id or appear in followUp',
    ]);

    tour.followUp = [
      { finding: "f-line", status: "outdated", note: "", refs: [] },
      { finding: "f-outside", status: "outdated", note: "", refs: [] },
      { finding: "f-outside", status: "outdated", note: "", refs: [] },
      { finding: "nope", status: "outdated", note: "", refs: [] },
    ];
    expect(errors(tour)).toEqual([
      'followUp "f-line" is also still open in the sections',
      'followUp "f-outside" appears more than once',
      'followUp "nope" is not a finding from revision 1',
    ]);
  });

  test("a resolved finding points at a hunk that changed", () => {
    const tour = fixtureTourR2();
    tour.followUp[0]!.refs = ["src/app.ts#1", "src/app.ts#9"];
    expect(errors(tour)).toEqual([
      'followUp "f-outside" says "src/app.ts#1" fixes it, but that hunk has not changed since revision 1',
      'followUp "f-outside" references unknown hunk "src/app.ts#9"',
    ]);
    tour.followUp[0]!.refs = [];
    expect(errors(tour)).toEqual([
      'followUp "f-outside" is resolved, so it needs the refs of the hunks that fix it',
    ]);
  });

  test("the first revision has nothing to follow up", () => {
    const tour = fixtureTourR2();
    expect(validateTour(tour, fixturePrR2, fixtureFilesR2).errors).toEqual([
      "followUp is only for revisions after the first",
    ]);
  });
});

describe("resolveAnchor", () => {
  test("multi-line anchors must stay within one hunk", () => {
    expect(
      resolveAnchor({ path: "src/app.ts", startLine: 1, line: 3, side: "RIGHT" }, fixtureFiles),
    ).toEqual({
      kind: "line",
      hunkId: "src/app.ts#1",
    });
    expect(
      resolveAnchor({ path: "src/app.ts", startLine: 3, line: 21, side: "RIGHT" }, fixtureFiles),
    ).toEqual({
      kind: "invalid",
      reason: "startLine and line must be in the same hunk",
    });
  });

  test("files outside the diff are unanchored, not invalid", () => {
    expect(resolveAnchor({ path: "README.md", line: 1, side: "RIGHT" }, fixtureFiles).kind).toBe(
      "unanchored",
    );
  });
});
