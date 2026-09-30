import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { computeChanges } from "../shared/changes.ts";
import {
  fixtureDraft,
  fixtureFiles,
  fixtureFilesR2,
  fixtureMeta,
  fixturePrR2,
  fixtureTour,
  fixtureTourR2,
  otherReviewer,
  tourAuthor,
} from "../shared/fixtures.ts";
import type { Draft, GitHubUser } from "../shared/schema.ts";
import { fakeGh } from "./fake-gh.ts";
import { draftFile, latestRevision, resolveTour } from "./review-dir.ts";
import { handleDraftPut } from "./serve.ts";
import { sync } from "./sync.ts";
import { writePrepared, writeTourRevision } from "./test-review.ts";

const repo = "repos/useshortcut/monorepo";
const postArgs = `api --method POST ${repo}/pulls/42/reviews --input -`;
const reviewUrl = "https://github.com/useshortcut/monorepo/pull/42#pullrequestreview-7";
const commentsArgs = `api --paginate --slurp ${repo}/pulls/42/reviews/7/comments`;
const commentUrl = "https://github.com/useshortcut/monorepo/pull/42#discussion_r91";

function postedComments() {
  return JSON.stringify([
    [
      {
        id: 91,
        path: "src/app.ts",
        side: "RIGHT",
        line: 2,
        body: "**Suggestion: Name the constant**\n\nMagic number.\n\n```suggestion\nconst B = 3;\n```",
        html_url: commentUrl,
      },
    ],
  ]);
}

function github(
  options: {
    head?: string;
    state?: string;
    author?: string;
    viewer?: GitHubUser;
    comments?: () => string;
  } = {},
) {
  return fakeGh({
    [`api ${repo}/pulls/42`]: JSON.stringify({
      state: options.state ?? "open",
      head: { sha: options.head ?? "head111" },
      user: { login: options.author ?? "someone-else" },
    }),
    "api user": JSON.stringify({ ...(options.viewer ?? tourAuthor), name: "Someone" }),
    [postArgs]: JSON.stringify({ id: 7, html_url: reviewUrl }),
    [commentsArgs]: options.comments ?? postedComments,
  });
}

let dir: string;
let revisionDir: string;
function writeReview(draft: Partial<Draft>, reviewer?: GitHubUser) {
  writePrepared(dir);
  revisionDir = writeTourRevision(dir, {
    tour: fixtureTour(),
    draft: fixtureDraft(draft),
    reviewer,
  });
}

const readDraft = (revision: string) =>
  JSON.parse(readFileSync(draftFile(revision, tourAuthor), "utf8")) as Draft;

const ready: Partial<Draft> = {
  event: "APPROVE",
  readyAt: "2026-09-25T12:00:00.000Z",
  findings: { "f-line": { status: "accepted" } },
};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "pr-tour-sync-"));
});

describe("sync", () => {
  test("posts one review at the reviewed commit and records where it went", async () => {
    writeReview(ready);
    const gh = github();
    const result = await sync({ gh, dir, now: () => new Date("2026-09-25T13:00:00Z") });

    expect(result).toMatchObject({ status: "posted", url: reviewUrl, warnings: [] });
    const post = gh.calls.find((call) => call.args.join(" ") === postArgs)!;
    expect(JSON.parse(post.input!)).toMatchObject({
      commit_id: "head111",
      event: "APPROVE",
      comments: [{ path: "src/app.ts", line: 2, side: "RIGHT" }],
    });
    expect(readDraft(revisionDir).synced).toEqual({
      at: "2026-09-25T13:00:00.000Z",
      url: reviewUrl,
      reviewId: 7,
      comments: [{ source: "finding:f-line", githubId: 91, url: commentUrl }],
    });
  });

  test("still records the posted review when its comments can't be read back", async () => {
    writeReview(ready);
    const gh = github({
      comments: () => {
        throw new Error("gh api failed: HTTP 502");
      },
    });
    const result = await sync({ gh, dir });
    expect(result).toMatchObject({
      status: "posted",
      warnings: [
        "the review was posted, but its comment links were not recorded: gh api failed: HTTP 502",
      ],
    });
    expect(readDraft(revisionDir).synced).toMatchObject({ url: reviewUrl, reviewId: 7 });
  });

  test("dry runs check everything but never post", async () => {
    writeReview(ready);
    const gh = github();
    const result = await sync({ gh, dir, dryRun: true });
    expect(result.status).toBe("dry-run");
    expect(gh.calls.map((call) => call.args.join(" "))).not.toContain(postArgs);
  });

  test("refuses to post when the PR has new commits", async () => {
    writeReview(ready);
    const gh = github({ head: "head222" });
    await expect(sync({ gh, dir })).rejects.toThrow(
      "new commits since tour claude-opus-5-5-head111 r1 was written (head111 → head222)",
    );
  });

  test("posts against the reviewed commit when outdated reviews are allowed", async () => {
    writeReview(ready);
    const gh = github({ head: "head222" });
    await sync({ gh, dir, allowOutdated: true });
    const post = gh.calls.find((call) => call.args.join(" ") === postArgs)!;
    expect(JSON.parse(post.input!).commit_id).toBe("head111");
  });

  test("refuses to approve your own PR", async () => {
    writeReview(ready);
    const gh = github({ author: tourAuthor.login });
    await expect(sync({ gh, dir })).rejects.toThrow("your own PR");
  });

  test("posts another reviewer's own comments but never the tour's findings", async () => {
    writeReview(
      {
        event: "COMMENT",
        body: "Second opinion.",
        readyAt: "2026-09-25T12:00:00.000Z",
        comments: [{ id: "c1", path: "src/app.ts", side: "RIGHT", line: 21, body: "Log this?" }],
      },
      otherReviewer,
    );
    const gh = github({ viewer: otherReviewer });
    await sync({ gh, dir });
    const post = gh.calls.find((call) => call.args.join(" ") === postArgs)!;
    expect(JSON.parse(post.input!).comments).toEqual([
      { path: "src/app.ts", side: "RIGHT", line: 21, body: "Log this?" },
    ]);

    writeReview(ready, otherReviewer);
    await expect(sync({ gh: github({ viewer: otherReviewer }), dir })).rejects.toThrow(
      "who created this tour, can post its findings",
    );
  });

  test("each reviewer posts their own draft of the same tour", async () => {
    writeReview({});
    const save = (viewer: GitHubUser, draft: Partial<Draft>) => {
      const entry = resolveTour(dir);
      const response = handleDraftPut(entry, latestRevision(entry), viewer, fixtureDraft(draft));
      expect(response.status).toBe(200);
    };
    save(tourAuthor, ready);
    save(otherReviewer, {
      event: "COMMENT",
      body: "Second opinion.",
      readyAt: "2026-09-25T12:00:00.000Z",
      comments: [{ id: "c1", path: "src/app.ts", side: "RIGHT", line: 21, body: "Log this?" }],
    });

    const theirs = github({ viewer: otherReviewer });
    await sync({ gh: theirs, dir });
    const theirPost = JSON.parse(theirs.calls.find((c) => c.args.join(" ") === postArgs)!.input!);
    expect(theirPost).toMatchObject({ event: "COMMENT", body: "Second opinion." });
    expect(theirPost.comments).toEqual([
      { path: "src/app.ts", side: "RIGHT", line: 21, body: "Log this?" },
    ]);

    const mine = github();
    await sync({ gh: mine, dir });
    const myPost = JSON.parse(mine.calls.find((c) => c.args.join(" ") === postArgs)!.input!);
    expect(myPost).toMatchObject({ event: "APPROVE", body: "" });
    expect(myPost.comments).toEqual([expect.objectContaining({ path: "src/app.ts", line: 2 })]);
  });

  test("asks which tour to post when there are several", async () => {
    writeReview(ready);
    writeTourRevision(dir, { meta: { ...fixtureMeta, id: "other-head111" } });
    await expect(sync({ gh: github(), dir })).rejects.toThrow("pass --tour with one of");
    const result = await sync({ gh: github(), dir, tour: fixtureMeta.id, dryRun: true });
    expect(result.status).toBe("dry-run");
  });

  test("refuses closed PRs, unfinished reviews, and repeat posts", async () => {
    writeReview(ready);
    await expect(sync({ gh: github({ state: "closed" }), dir })).rejects.toThrow(
      "the PR is closed",
    );

    writeReview({ ...ready, readyAt: null });
    await expect(sync({ gh: github(), dir })).rejects.toThrow("not finished");

    writeReview({ ...ready, synced: { at: "2026-09-25T13:00:00.000Z", url: reviewUrl } });
    await expect(sync({ gh: github(), dir })).rejects.toThrow("already posted");
  });

  test("posts the latest revision without repeating findings posted in an earlier one", async () => {
    writeReview({ ...ready, synced: { at: "2026-09-25T13:00:00.000Z", url: reviewUrl } });
    const changes = computeChanges(
      { revision: 1, headSha: "head111", files: fixtureFiles },
      { revision: 2, headSha: "head222", files: fixtureFilesR2 },
    );
    const revision2 = writeTourRevision(dir, {
      revision: 2,
      pr: fixturePrR2,
      files: fixtureFilesR2,
      changes,
      tour: fixtureTourR2(),
      draft: { ...fixtureDraft(ready), headSha: "head222" },
    });
    await expect(sync({ gh: github({ head: "head222" }), dir })).rejects.toThrow(
      'already posted in an earlier revision, so they can\'t be posted again: "f-line"',
    );

    writeTourRevision(dir, {
      revision: 2,
      pr: fixturePrR2,
      files: fixtureFilesR2,
      changes,
      tour: fixtureTourR2(),
      draft: {
        ...fixtureDraft({
          ...ready,
          event: "COMMENT",
          body: "Thanks for the rename.",
          findings: {},
        }),
        headSha: "head222",
      },
    });
    const gh = github({ head: "head222" });
    await sync({ gh, dir });
    const post = gh.calls.find((call) => call.args.join(" ") === postArgs)!;
    expect(JSON.parse(post.input!)).toMatchObject({ commit_id: "head222", comments: [] });
    expect(readDraft(revision2).synced).toMatchObject({ reviewId: 7 });
    expect(readDraft(revisionDir).synced).toMatchObject({ url: reviewUrl });
  });
});
