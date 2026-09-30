import { describe, expect, test } from "bun:test";
import { computeChanges } from "../shared/changes.ts";
import {
  fixtureDraft,
  fixtureFiles,
  fixtureFilesR2,
  fixtureTour,
  fixtureTourR2,
} from "../shared/fixtures.ts";
import { draftReducer, readinessProblems } from "./draft.ts";
import { buildSections, lineKey, sinceRevision, UNANNOTATED_SECTION_ID } from "./tour-model.ts";

describe("buildSections", () => {
  test("places anchored findings on their line and the rest at the section end", () => {
    const [core] = buildSections(fixtureTour(), fixtureFiles, []);
    expect(core!.entries.map((e) => e.ref)).toEqual(["src/app.ts#1", "src/app.ts#2"]);
    expect([...core!.inlineFindings.keys()]).toEqual([lineKey("src/app.ts#1", "RIGHT", 2)]);
    expect(core!.otherFindings.map((f) => f.id)).toEqual(["f-outside"]);
  });

  test("places range notes on the diff lines they cover", () => {
    const tour = fixtureTour();
    tour.sections[0]!.hunks[1]!.ranges = [
      { line: 22, side: "RIGHT", note: "second" },
      { startLine: 20, line: 21, side: "RIGHT", note: "first" },
      { line: 10, side: "RIGHT", note: "outside" },
    ];
    const entry = buildSections(tour, fixtureFiles, [])[0]!.entries[1]!;
    expect(entry.ranges).toEqual([
      { start: 0, end: 1, note: "first" },
      { start: 2, end: 2, note: "second" },
    ]);
    expect(entry.unplacedRanges).toEqual([{ line: 10, side: "RIGHT", note: "outside" }]);
  });

  test("appends hunks the tour skipped so nothing is hidden", () => {
    const sections = buildSections(fixtureTour(), fixtureFiles, ["logo.png"]);
    expect(sections.at(-1)).toMatchObject({ id: UNANNOTATED_SECTION_ID, synthetic: true });
    expect(sections.at(-1)!.entries.map((e) => e.ref)).toEqual(["logo.png"]);
  });

  test("shows the raw diff when there is no tour", () => {
    const sections = buildSections(null, fixtureFiles, []);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.entries.map((e) => e.ref)).toEqual([
      "src/app.ts#1",
      "src/app.ts#2",
      "logo.png",
    ]);
  });
});

describe("draftReducer", () => {
  test("editing a finding accepts it, and undo clears the decision", () => {
    let draft = draftReducer(fixtureDraft(), {
      type: "editFinding",
      id: "f-line",
      body: "Reworded",
    });
    expect(draft.findings["f-line"]).toEqual({ status: "accepted", body: "Reworded" });
    draft = draftReducer(draft, { type: "decideFinding", id: "f-line", status: null });
    expect(draft.findings).toEqual({});
  });

  test("toggles viewed sections", () => {
    const once = draftReducer(fixtureDraft(), { type: "toggleViewed", sectionId: "core" });
    expect(once.viewedSections).toEqual(["core"]);
    expect(draftReducer(once, { type: "toggleViewed", sectionId: "core" }).viewedSections).toEqual(
      [],
    );
  });

  test("readiness allows comments without a summary but rejects an empty comment review", () => {
    expect(readinessProblems(fixtureDraft())).toHaveLength(1);
    expect(readinessProblems(fixtureDraft({ event: "COMMENT" }))).toEqual([
      "Add a summary, a line comment, or accept a finding.",
    ]);
    expect(readinessProblems(fixtureDraft({ event: "APPROVE" }))).toEqual([]);
    expect(readinessProblems(fixtureDraft({ event: "COMMENT" }), 1)).toEqual([]);
    expect(
      readinessProblems(
        fixtureDraft({
          event: "COMMENT",
          comments: [{ id: "c1", path: "src/app.ts", side: "RIGHT", line: 2, body: "Name this?" }],
        }),
      ),
    ).toEqual([]);
    expect(
      readinessProblems(
        fixtureDraft({
          event: "COMMENT",
          comments: [{ id: "c1", path: "src/app.ts", side: "RIGHT", line: 2, body: "  " }],
        }),
      ),
    ).toHaveLength(1);
    expect(readinessProblems(fixtureDraft({ event: "REQUEST_CHANGES" }), 1)).toEqual([
      "Add a summary when requesting changes.",
    ]);
  });
});

describe("sinceRevision", () => {
  test("sorts what changed, what the agent followed up, and which findings are new", () => {
    const changes = computeChanges(
      { revision: 1, headSha: "head111", files: fixtureFiles },
      { revision: 2, headSha: "head222", files: fixtureFilesR2 },
    );
    const tour = fixtureTourR2();
    tour.sections[1]!.findings.push({
      id: "f-new",
      severity: "nit",
      title: "New nit",
      body: "",
      anchor: { path: "logo.png", side: "RIGHT" },
    });
    const since = sinceRevision(tour, fixtureTour(), changes);
    expect(since.changed).toEqual([
      { ref: "src/app.ts#2", note: "renamed call", section: "Core change" },
      { ref: "logo.png", note: "new logo", section: "Assets" },
    ]);
    expect(since.dropped).toEqual([]);
    expect(since.followUp).toMatchObject([
      { finding: "f-outside", status: "resolved", previous: { title: "Other callers?" } },
    ]);
    expect(since.stillOpen.map((f) => f.id)).toEqual(["f-line"]);
    expect(since.added.map((f) => f.id)).toEqual(["f-new"]);
  });
});
