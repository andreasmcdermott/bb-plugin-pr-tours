import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  fixtureDraft,
  fixtureFilesR2,
  fixtureMeta,
  fixturePrR2,
  fixtureTour,
  otherReviewer,
  tourAuthor,
} from "../shared/fixtures.ts";
import type { GitHubUser } from "../shared/schema.ts";
import { fakeGh } from "./fake-gh.ts";
import { draftFile, listTours } from "./review-dir.ts";
import { revise } from "./revise.ts";
import { writePrepared, writeTourRevision } from "./test-review.ts";

const asUser = (user: GitHubUser) => fakeGh({ "api user": JSON.stringify(user) });

let dir: string;
let first: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "pr-tour-revise-"));
  writePrepared(dir, fixturePrR2, fixtureFilesR2);
  first = writeTourRevision(dir, { tour: fixtureTour(), draft: fixtureDraft({ body: "r1" }) });
});

describe("revise", () => {
  test("starts the next revision pinned to the new head, with what changed", async () => {
    const result = await revise({
      gh: asUser(tourAuthor),
      dir,
      now: () => new Date("2026-09-26T09:00:00Z"),
    });
    expect(result.revision.meta).toEqual({
      revision: 2,
      headSha: "head222",
      model: "claude-opus-5-5",
      agent: "claude-code",
      createdAt: "2026-09-26T09:00:00.000Z",
    });
    expect(result.changes).toMatchObject({
      carried: [{ ref: "src/app.ts#1", previous: "src/app.ts#1" }],
      changed: ["src/app.ts#2", "logo.png"],
      dropped: ["src/app.ts#2", "logo.png"],
    });
    expect(result.openFindings).toEqual(["f-line", "f-outside"]);

    const [entry] = listTours(dir);
    expect(entry!.id).toBe(fixtureMeta.id);
    expect(entry!.revisions.map((r) => [r.revision, r.meta.headSha, r.load.status])).toEqual([
      [1, "head111", "ok"],
      [2, "head222", "missing"],
    ]);
    const snapshot = path.join(result.revision.dir, "pr.json");
    expect(JSON.parse(readFileSync(snapshot, "utf8")).headSha).toBe("head222");
    expect(JSON.parse(readFileSync(draftFile(first, tourAuthor), "utf8")).body).toBe("r1");
  });

  test("only the tour's author can revise it", async () => {
    await expect(revise({ gh: asUser(otherReviewer), dir })).rejects.toThrow(
      "only andreasmcdermott, who created tour claude-opus-5-5-head111, can revise it",
    );
  });

  test("needs new commits and a finished tour", async () => {
    writePrepared(dir);
    await expect(revise({ gh: asUser(tourAuthor), dir })).rejects.toThrow(
      "r1 already covers head111",
    );

    writePrepared(dir, fixturePrR2, fixtureFilesR2);
    writeTourRevision(dir, { tour: { version: 1 } });
    await expect(revise({ gh: asUser(tourAuthor), dir })).rejects.toThrow(
      "r1 has no valid tour.json yet",
    );
  });
});
