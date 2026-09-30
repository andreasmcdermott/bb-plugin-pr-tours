import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  fixtureDraft,
  fixtureFiles,
  fixtureFilesR2,
  fixtureMeta,
  fixturePr,
  fixturePrR2,
  fixtureTour,
  fixtureTourR2,
  otherReviewer,
  tourAuthor,
} from "../shared/fixtures.ts";
import { computeChanges } from "../shared/changes.ts";
import type { GitHubUser } from "../shared/schema.ts";
import { draftFile, writeJson } from "./review-dir.ts";
import { serve } from "./serve.ts";
import { writePrepared, writeTourRevision } from "./test-review.ts";

let dir: string;
let tourFile: string;
let servers: ReturnType<typeof serve>[] = [];

function start(viewer: GitHubUser) {
  const server = serve({ dir, port: 0, viewer });
  servers.push(server);
  const base = `http://127.0.0.1:${server.port}`;
  const url = (route: string, tour = fixtureMeta.id, rev?: number) =>
    `${base}${route}?tour=${tour}${rev ? `&rev=${rev}` : ""}`;
  const put = (body: unknown, rev?: number, tour?: string) =>
    fetch(url("/api/draft", tour, rev), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { base, url, put };
}

let author: ReturnType<typeof start>;
let other: ReturnType<typeof start>;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "pr-tour-serve-"));
  writePrepared(dir);
  tourFile = path.join(writeTourRevision(dir, { tour: fixtureTour() }), "tour.json");
  writeTourRevision(dir, {
    meta: { ...fixtureMeta, id: "gpt-old", model: "gpt", createdAt: "2026-09-26T00:00:00.000Z" },
    pr: { ...fixturePr, headSha: "head000" },
    tour: fixtureTour({ headSha: "head000" }),
  });
  author = start(tourAuthor);
  other = start(otherReviewer);
});

afterAll(() => {
  for (const server of servers) server.stop(true);
  servers = [];
});

describe("serve", () => {
  test("lists tours with the ones at the current head first", async () => {
    const { viewer, tours } = await (await fetch(`${author.base}/api/tours`)).json();
    expect(viewer).toEqual(tourAuthor);
    expect(tours.map((tour: { id: string; headSha: string }) => [tour.id, tour.headSha])).toEqual([
      [fixtureMeta.id, "head111"],
      ["gpt-old", "head000"],
    ]);
  });

  test("returns the chosen tour with its validation and who wrote it", async () => {
    const review = await (await fetch(author.url("/api/review"))).json();
    expect(review.pr.headSha).toBe("head111");
    expect(review.validation.errors).toEqual([]);
    expect(review.meta.author).toEqual(tourAuthor);
    expect(review.isAuthor).toBe(true);
    expect(review.syncCommand).toEndWith(` --tour ${fixtureMeta.id}`);

    expect((await (await fetch(other.url("/api/review"))).json()).isAuthor).toBe(false);
  });

  test("needs a tour when there are several, and 404s unknown ones", async () => {
    expect((await fetch(`${author.base}/api/review`)).status).toBe(404);
    const response = await fetch(author.url("/api/review", "../../etc"));
    expect(response.status).toBe(404);
    expect((await response.json()).errors[0]).toStartWith('no tour "../../etc"');
  });

  test("reports schema errors in tour.json instead of failing", async () => {
    writeFileSync(tourFile, JSON.stringify({ version: 1 }));
    const review = await (await fetch(author.url("/api/review"))).json();
    expect(review.tour).toBeNull();
    expect(review.tourErrors).toContain(
      "headSha: Invalid input: expected string, received undefined",
    );
    writeJson(tourFile, fixtureTour());
  });

  test("rejects requests that do not come to a loopback host", async () => {
    const response = await fetch(author.url("/api/review"), {
      headers: { host: "evil.example:80" },
    });
    expect(response.status).toBe(403);
  });

  test("saves valid drafts and rejects drafts for another commit", async () => {
    const draft = fixtureDraft({ body: "saved" });
    expect((await author.put(draft)).status).toBe(200);
    expect((await (await fetch(author.url("/api/draft"))).json()).body).toBe("saved");

    expect((await author.put({ ...draft, headSha: "other" })).status).toBe(409);
    expect((await author.put({ nope: true })).status).toBe(400);
  });

  test("only the tour's author can decide on its findings", async () => {
    const decided = fixtureDraft({ findings: { "f-line": { status: "accepted" } } });
    const response = await other.put(decided);
    expect(response.status).toBe(403);
    expect((await response.json()).errors).toEqual([
      "only andreasmcdermott can decide on this tour's findings",
    ]);
    expect((await other.put(fixtureDraft({ body: "my own notes" }))).status).toBe(200);
    expect((await author.put(decided)).status).toBe(200);
  });

  test("refuses edits once the review is posted", async () => {
    const synced = fixtureDraft({
      synced: { at: "2026-09-25T13:00:00.000Z", url: "https://example.com" },
    });
    expect((await author.put(synced)).status).toBe(200);
    const response = await author.put(fixtureDraft({ body: "changed" }));
    expect(response.status).toBe(409);
    expect((await response.json()).errors[0]).toStartWith("already posted to GitHub");
  });

  describe("revisions", () => {
    const revisedId = "revised";
    const meta = { ...fixtureMeta, id: revisedId, createdAt: "2026-09-20T00:00:00.000Z" };
    const changes = computeChanges(
      { revision: 1, headSha: "head111", files: fixtureFiles },
      { revision: 2, headSha: "head222", files: fixtureFilesR2 },
    );

    const tourR2 = fixtureTourR2();
    const call = tourR2.sections[0]!.hunks.splice(1);
    tourR2.sections.splice(1, 0, {
      id: "call",
      title: "Call",
      narrative: "",
      hunks: call,
      findings: [],
    });

    beforeAll(() => {
      writeTourRevision(dir, {
        meta,
        tour: fixtureTour(),
        draft: fixtureDraft({
          viewedSections: ["core", "assets"],
          findings: { "f-line": { status: "accepted" }, "f-outside": { status: "dismissed" } },
          synced: { at: "2026-09-25T13:00:00.000Z", url: "https://example.com/review" },
        }),
      });
      writeTourRevision(dir, {
        meta,
        revision: 2,
        pr: fixturePrR2,
        files: fixtureFilesR2,
        changes,
        tour: tourR2,
      });
    });

    test("serves the latest revision with what changed since the one before", async () => {
      const review = await (await fetch(author.url("/api/review", revisedId))).json();
      expect(review.revision.revision).toBe(2);
      expect(review.isLatest).toBe(true);
      expect(review.pr.headSha).toBe("head222");
      expect(review.liveHeadSha).toBe("head111");
      expect(review.validation.errors).toEqual([]);
      expect(review.previous.revision).toBe(1);
      expect(review.changes.changed).toEqual(["src/app.ts#2", "logo.png"]);
      expect(review.history["f-line"]).toMatchObject({ revision: 1, posted: true });
      expect(review.unchangedSections).toEqual(["core"]);

      const first = await (await fetch(author.url("/api/review", revisedId, 1))).json();
      expect(first.isLatest).toBe(false);
      expect(first.pr.headSha).toBe("head111");
    });

    test("starts each revision with a fresh draft that keeps unchanged viewed sections", async () => {
      const draft = await (await fetch(author.url("/api/draft", revisedId))).json();
      expect(draft).toMatchObject({ headSha: "head222", findings: {}, synced: null });
      expect(draft.viewedSections).toEqual(["core"]);

      const theirs = await (await fetch(other.url("/api/draft", revisedId))).json();
      expect(theirs.viewedSections).toEqual([]);
    });

    test("keeps earlier revisions read-only and posted findings closed", async () => {
      const early = await author.put(fixtureDraft({ body: "late edit" }), 1, revisedId);
      expect(early.status).toBe(409);
      expect((await early.json()).errors).toEqual(["r1 is read-only; the tour is at r2"]);

      const draft = { ...fixtureDraft(), headSha: "head222" };
      const repeat = await author.put(
        { ...draft, findings: { "f-line": { status: "accepted" } } },
        2,
        revisedId,
      );
      expect(repeat.status).toBe(409);
      expect((await repeat.json()).errors).toEqual([
        'already posted in an earlier revision: "f-line"',
      ]);
      expect((await author.put({ ...draft, body: "r2 notes" }, 2, revisedId)).status).toBe(200);
      const saved = draftFile(path.join(dir, "tours", revisedId, "revisions", "2"), tourAuthor);
      expect(JSON.parse(readFileSync(saved, "utf8")).body).toBe("r2 notes");
    });
  });

  describe("several reviewers", () => {
    const sharedId = "shared";
    const draftOf = async (viewer: typeof author) =>
      (await fetch(viewer.url("/api/draft", sharedId))).json();

    beforeAll(() => {
      writeTourRevision(dir, { meta: { ...fixtureMeta, id: sharedId }, tour: fixtureTour() });
    });

    test("each reviewer keeps their own draft of the same tour", async () => {
      const decided = fixtureDraft({
        findings: { "f-line": { status: "accepted" } },
        body: "author notes",
      });
      expect((await author.put(decided, undefined, sharedId)).status).toBe(200);

      const theirs = await draftOf(other);
      expect(theirs).toMatchObject({ findings: {}, body: "" });
      const second = { ...theirs, body: "second opinion" };
      expect((await other.put(second, undefined, sharedId)).status).toBe(200);

      expect(await draftOf(author)).toMatchObject({
        body: "author notes",
        findings: { "f-line": { status: "accepted" } },
      });
      expect((await draftOf(other)).body).toBe("second opinion");
    });

    test("one reviewer posting does not lock the other out", async () => {
      const synced = { at: "2026-09-25T13:00:00.000Z", url: "https://example.com/review" };
      expect((await author.put(fixtureDraft({ synced }), undefined, sharedId)).status).toBe(200);
      const edit = fixtureDraft({ body: "still editing" });
      expect((await other.put(edit, undefined, sharedId)).status).toBe(200);
      expect((await draftOf(other)).synced).toBeNull();
    });
  });
});
