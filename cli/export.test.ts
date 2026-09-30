import { describe, expect, test } from "bun:test";
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
} from "../shared/fixtures.ts";
import { emptyDraft, type Draft } from "../shared/schema.ts";
import { STATIC_DATA_ID, type StaticData } from "../viewer/api.ts";
import { embedData, exportTour, staticData } from "./export.ts";
import { writePrepared, writeTourRevision } from "./test-review.ts";

function reviewDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "pr-tour-export-test-"));
  writePrepared(dir);
  return dir;
}

const key = `${fixtureMeta.id}@1`;

function writeTwoRevisions(dir: string, overrides: Partial<Draft> = {}) {
  const authorDraft = fixtureDraft({
    findings: { "f-line": { status: "dismissed" } },
    comments: [{ id: "c1", path: "src/app.ts", side: "RIGHT", line: 21, body: "unposted" }],
    viewedSections: ["core"],
    body: "mine",
    ...overrides,
  });
  writeTourRevision(dir, { tour: fixtureTour(), draft: authorDraft });
  writeTourRevision(dir, {
    revision: 2,
    pr: fixturePrR2,
    files: fixtureFilesR2,
    changes: computeChanges(
      { revision: 1, headSha: "head111", files: fixtureFiles },
      { revision: 2, headSha: "head222", files: fixtureFilesR2 },
    ),
    tour: fixtureTourR2(),
  });
  return authorDraft;
}

describe("staticData", () => {
  test("exports a read-only tour whose revisions all start from an empty draft", () => {
    const dir = reviewDir();
    writeTwoRevisions(dir);

    const data = staticData(dir);
    expect(data.mode).toBe("read");
    expect(data.drafts).toEqual({
      [key]: emptyDraft("head111"),
      [`${fixtureMeta.id}@2`]: emptyDraft("head222"),
    });
  });

  test("leaves out decisions the author never posted", () => {
    const dir = reviewDir();
    writeTwoRevisions(dir);

    expect(staticData(dir).reviews[`${fixtureMeta.id}@2`]!.history).toEqual({});
  });

  test("keeps findings posted in earlier revisions", () => {
    const dir = reviewDir();
    const synced = { at: "2026-09-25T13:00:00.000Z", url: "https://github.com/o/r/pull/1#review" };
    writeTwoRevisions(dir, { findings: { "f-line": { status: "accepted" } }, synced });

    expect(staticData(dir).reviews[`${fixtureMeta.id}@2`]!.history).toEqual({
      "f-line": { revision: 1, status: "accepted", posted: true, url: synced.url },
    });
  });

  test("replaces local paths in commands", () => {
    const dir = reviewDir();
    writeTourRevision(dir, { tour: fixtureTour() });

    const review = staticData(dir).reviews[key]!;
    const name = path.basename(dir);
    expect(review.dir).toBe(name);
    expect(review.syncCommand).toBe(`bun run pr-tour sync ${name} --tour ${fixtureMeta.id}`);
    expect(JSON.stringify(review)).not.toContain(dir);
  });

  test("keeps the tour's range notes", () => {
    const dir = reviewDir();
    const tour = fixtureTour();
    const ranges = [{ startLine: 20, line: 21, side: "RIGHT" as const, note: "the new call" }];
    tour.sections[0]!.hunks[1]!.ranges = ranges;
    writeTourRevision(dir, { tour });

    const exported = staticData(dir).reviews[key]!.tour!;
    expect(exported.sections[0]!.hunks[1]!.ranges).toEqual(ranges);
  });

  test("exports only the chosen tour", () => {
    const dir = reviewDir();
    writeTourRevision(dir, { tour: fixtureTour() });
    writeTourRevision(dir, {
      meta: { ...fixtureMeta, id: "teammate-tour", author: otherReviewer },
      tour: fixtureTour(),
    });

    const data = staticData(dir, { tour: "teammate-tour" });
    expect(data.tours.tours.map((tour) => tour.id)).toEqual(["teammate-tour"]);
    expect(Object.keys(data.reviews)).toEqual(["teammate-tour@1"]);
    expect(data.reviews["teammate-tour@1"]!.viewer).toEqual(otherReviewer);
  });

  test("refuses tours that are missing or invalid", () => {
    const dir = reviewDir();
    writeTourRevision(dir);
    expect(() => staticData(dir)).toThrow("has no valid tour.json to export");

    const invalid = reviewDir();
    writeTourRevision(invalid, { tour: fixtureTour({ headSha: "head000" }) });
    expect(() => staticData(invalid)).toThrow("has validation errors");
  });
});

describe("embedData", () => {
  test("embeds the data so markup inside the diff cannot end the script early", () => {
    const data = { tours: { tours: [] }, note: "</script><script>alert(1)</script>" };
    const html = embedData(
      "<html><head><title>t</title></head><body></body></html>",
      data as unknown as StaticData,
    );
    const script = html.match(/<script id="pr-tour-data" type="application\/json">(.*?)<\/script>/);
    expect(script).not.toBeNull();
    expect(JSON.parse(script![1]!)).toEqual(data);
    expect(html).toEndWith("</head><body></body></html>");
  });

  test("asks search engines not to index the page", () => {
    const html = embedData("<html><head></head><body></body></html>", {} as StaticData);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  test("needs a head to embed into", () => {
    expect(() => embedData("<body></body>", {} as StaticData)).toThrow("no </head>");
  });
});

function exportedData(html: string): StaticData {
  const script = html.match(/<script id="pr-tour-data" type="application\/json">(.*?)<\/script>/);
  return JSON.parse(script![1]!) as StaticData;
}

describe("exportTour", () => {
  test("writes one self-contained HTML file named after the PR", () => {
    const dir = reviewDir();
    writeTourRevision(dir, { tour: fixtureTour() });

    const out = path.join(dir, "export");
    const result = exportTour({ dir, out });
    const html = readFileSync(result.file, "utf8");
    expect(result.file).toBe(path.join(out, `${path.basename(dir)}-tour.html`));
    expect(html).toContain(`<script id="${STATIC_DATA_ID}" type="application/json">`);
    expect(html).not.toMatch(/(src|href)="[^"]*\.(js|css)"/);
    expect(exportedData(html).mode).toBe("read");
  }, 30_000);
});
