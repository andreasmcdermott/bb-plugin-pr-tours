import { describe, expect, test } from "bun:test";
import { fixtureDraft, fixtureFiles, fixtureTour, otherReviewer, tourAuthor } from "./fixtures.ts";
import { buildReview, findingCommentBody, findingHistory, postedFindings } from "./review.ts";

const byAuthor = { author: tourAuthor, reviewer: tourAuthor };
const byOther = { author: tourAuthor, reviewer: otherReviewer };

describe("buildReview", () => {
  test("posts only accepted findings, and moves ones outside the diff into the body", () => {
    const draft = fixtureDraft({
      event: "REQUEST_CHANGES",
      body: "A couple of things.",
      findings: {
        "f-line": { status: "accepted", body: "Please name it." },
        "f-outside": { status: "accepted" },
      },
    });
    const review = buildReview(fixtureTour(), draft, fixtureFiles, byAuthor).payload;
    expect(review.commit_id).toBe("head111");
    expect(review.event).toBe("REQUEST_CHANGES");
    expect(review.comments).toEqual([
      {
        path: "src/app.ts",
        line: 2,
        side: "RIGHT",
        body: "**Suggestion: Name the constant**\n\nPlease name it.\n\n```suggestion\nconst B = 3;\n```",
      },
    ]);
    expect(review.body).toBe(
      "A couple of things.\n\n### Notes outside the diff\n\n#### `src/app.ts:10`\n\n**Question: Other callers?**\n\nDoes anything else read b?",
    );
  });

  test("skips dismissed and untouched findings", () => {
    const draft = fixtureDraft({
      event: "APPROVE",
      findings: { "f-line": { status: "dismissed" } },
    });
    expect(buildReview(fixtureTour(), draft, fixtureFiles, byAuthor).payload).toEqual({
      commit_id: "head111",
      event: "APPROVE",
      body: "",
      comments: [],
    });
  });

  test("includes the reviewer's own line comments and drops empty ones", () => {
    const draft = fixtureDraft({
      event: "COMMENT",
      body: "Looks close.",
      comments: [
        { id: "c1", path: "src/app.ts", side: "LEFT", line: 2, body: " Why remove this? " },
        { id: "c2", path: "src/app.ts", side: "RIGHT", line: 21, body: "  " },
      ],
    });
    expect(buildReview(fixtureTour(), draft, fixtureFiles, byAuthor).payload.comments).toEqual([
      { path: "src/app.ts", side: "LEFT", line: 2, body: "Why remove this?" },
    ]);
  });

  test("sends multi-line ranges with start_line", () => {
    const tour = fixtureTour();
    tour.sections[0]!.findings[0]!.anchor = {
      path: "src/app.ts",
      startLine: 1,
      line: 3,
      side: "RIGHT",
    };
    const draft = fixtureDraft({
      event: "COMMENT",
      body: "One range.",
      findings: { "f-line": { status: "accepted" } },
    });
    expect(buildReview(tour, draft, fixtureFiles, byAuthor).payload.comments[0]).toMatchObject({
      line: 3,
      start_line: 1,
      start_side: "RIGHT",
    });
  });

  test("lets other reviewers post their own comments on someone else's tour", () => {
    const draft = fixtureDraft({
      event: "COMMENT",
      body: "Adding to the tour.",
      comments: [{ id: "c1", path: "src/app.ts", side: "RIGHT", line: 21, body: "Log this?" }],
    });
    expect(buildReview(fixtureTour(), draft, fixtureFiles, byOther).payload).toEqual({
      commit_id: "head111",
      event: "COMMENT",
      body: "Adding to the tour.",
      comments: [{ path: "src/app.ts", side: "RIGHT", line: 21, body: "Log this?" }],
    });
  });

  test("only the tour's author can post its findings", () => {
    const draft = fixtureDraft({
      event: "COMMENT",
      body: "Agreed with the agent.",
      findings: { "f-line": { status: "accepted" } },
    });
    expect(() => buildReview(fixtureTour(), draft, fixtureFiles, byOther)).toThrow(
      "only andreasmcdermott, who created this tour, can post its findings",
    );
    expect(buildReview(fixtureTour(), draft, fixtureFiles, byAuthor).payload.comments).toHaveLength(
      1,
    );
  });

  test("requires a decision, and a summary unless approving", () => {
    expect(() => buildReview(fixtureTour(), fixtureDraft(), fixtureFiles, byAuthor)).toThrow(
      "no review decision",
    );
    expect(() =>
      buildReview(fixtureTour(), fixtureDraft({ event: "COMMENT" }), fixtureFiles, byAuthor),
    ).toThrow("requires a review summary");
  });
});

describe("revisions", () => {
  const synced = (comments: { source: string; githubId: number; url: string }[] = []) => ({
    at: "2026-09-25T13:00:00.000Z",
    url: "https://github.com/r/1",
    reviewId: 1,
    comments,
  });

  test("history keeps the latest decision, but a posted finding stays posted", () => {
    const history = findingHistory([
      {
        revision: 1,
        draft: fixtureDraft({
          findings: { "f-line": { status: "accepted" }, "f-outside": { status: "dismissed" } },
          synced: synced([
            { source: "finding:f-line", githubId: 7, url: "https://github.com/c/7" },
          ]),
        }),
      },
      {
        revision: 2,
        draft: fixtureDraft({
          findings: { "f-line": { status: "dismissed" }, "f-outside": { status: "accepted" } },
        }),
      },
    ]);
    expect(history).toEqual({
      "f-line": { revision: 1, status: "accepted", posted: true, url: "https://github.com/c/7" },
      "f-outside": { revision: 2, status: "accepted", posted: false, url: null },
    });
    expect([...postedFindings(history)]).toEqual(["f-line"]);
  });

  test("refuses to post a finding again and says where each comment came from", () => {
    const draft = fixtureDraft({
      event: "COMMENT",
      body: "Again.",
      findings: { "f-line": { status: "accepted" } },
      comments: [{ id: "c1", path: "src/app.ts", side: "RIGHT", line: 21, body: "Mine" }],
    });
    expect(buildReview(fixtureTour(), draft, fixtureFiles, byAuthor).sources).toEqual([
      "finding:f-line",
      "comment:c1",
    ]);
    expect(() =>
      buildReview(fixtureTour(), draft, fixtureFiles, byAuthor, new Set(["f-line"])),
    ).toThrow(`already posted in an earlier revision, so they can't be posted again: "f-line"`);
  });
});

describe("findingCommentBody", () => {
  test("uses a longer fence when the suggestion contains backticks", () => {
    const finding = fixtureTour().sections[0]!.findings[0]!;
    const body = findingCommentBody({ ...finding, body: "", suggestion: "const s = ```x```;" });
    expect(body).toBe(
      "**Suggestion: Name the constant**\n\n````suggestion\nconst s = ```x```;\n````",
    );
  });
});
