import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { createHostEntry } from "../host.ts";
import { fakeGh } from "../cli/fake-gh.ts";
import { writePrepared, writeTourRevision } from "../cli/test-review.ts";
import {
  fixtureDraft,
  fixtureMeta,
  fixturePr,
  fixtureTour,
  otherReviewer,
  tourAuthor,
} from "../shared/fixtures.ts";

const dirs: string[] = [];
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((fn) => fn()));
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "bb-pr-tours-test-"));
  dirs.push(root);
  const dir = path.join(root, "source");
  writePrepared(dir);
  writeTourRevision(dir, { tour: fixtureTour() });
  let user = tourAuthor;
  const run = fakeGh({ "api user": () => JSON.stringify(user) });
  const harness = experimental_createHostEntryHarness(createHostEntry(run), {
    experimental_paths: { dataDir: path.join(root, "data"), tempDir: path.join(root, "tmp") },
  });
  disposers.push(() => harness.experimental_dispose());
  return {
    dir,
    harness,
    run,
    setUser: (value: typeof tourAuthor) => {
      user = value;
    },
  };
}
const ref = { tourId: fixtureMeta.id, revision: 1 };
describe("host worker", () => {
  it("imports a portable review, validates it, and retains pinned snapshots", async () => {
    const { harness, dir } = setup();
    const imported = await harness.experimental_call("import", { dir });
    expect(imported.dir).not.toBe(dir);
    const review = await harness.experimental_call("review", { dir: imported.dir, ref });
    expect(review.pr.headSha).toBe(fixturePr.headSha);
    expect(review.tour?.summary).toBe(fixtureTour().summary);
    expect(
      (
        await harness.experimental_call("command", {
          dir: imported.dir,
          action: "validate",
          tour: ref.tourId,
        })
      ).valid,
    ).toBe(true);
    await expect(harness.experimental_call("import", { dir })).rejects.toThrow("already exists");
    expect(readFileSync(path.join(dir, "pr.json"), "utf8")).toContain(fixturePr.headSha);
  });
  it("persists reviewer drafts and refuses account changes or non-author finding decisions", async () => {
    const { harness, dir, setUser } = setup();
    const draft = fixtureDraft({
      body: "My private review",
      findings: { "f-line": { status: "accepted" } },
    });
    await harness.experimental_call("save", { dir, ref, draft, viewerId: tourAuthor.id });
    expect((await harness.experimental_call("draft", { dir, ref })).body).toBe("My private review");
    setUser(otherReviewer);
    await expect(
      harness.experimental_call("save", { dir, ref, draft, viewerId: tourAuthor.id }),
    ).rejects.toThrow("account");
    await expect(
      harness.experimental_call("save", { dir, ref, draft, viewerId: otherReviewer.id }),
    ).rejects.toThrow("only");
    expect((await harness.experimental_call("draft", { dir, ref })).body).toBe("");
  });
  it("exports a reading copy with no private drafts", async () => {
    const { harness, dir } = setup();
    const draft = fixtureDraft({
      body: "Do not export this",
      comments: [
        { id: "private", path: "src/app.ts", side: "RIGHT", line: 21, body: "Private comment" },
      ],
    });
    await harness.experimental_call("save", { dir, ref, draft, viewerId: tourAuthor.id });
    const data = await harness.experimental_call("export", { dir, tourId: ref.tourId });
    expect(data.mode).toBe("read");
    expect(JSON.stringify(data)).not.toContain("Do not export this");
    expect(JSON.stringify(data)).not.toContain("Private comment");
    expect(JSON.stringify(data)).not.toContain(dir);
    expect(data.drafts[`${ref.tourId}@1`].comments).toEqual([]);
  });
});

it("imports agent-authored JSON only after validating ownership and the pinned diff", async () => {
  const { dir, harness, setUser } = setup();
  const source = path.join(dir, "agent-output.json");
  const original = (await harness.experimental_call("review", { dir, ref })).tour!.summary;
  const changed = { ...fixtureTour(), summary: "Agent-authored update from thread storage" };
  const { writeFileSync } = await import("node:fs");
  writeFileSync(source, JSON.stringify({ ...changed, headSha: "wrong-commit" }));
  const invalid = await harness.experimental_call("command", {
    dir,
    action: "write-tour",
    tour: ref.tourId,
    file: source,
  });
  expect(invalid.valid).toBe(false);
  expect((await harness.experimental_call("review", { dir, ref })).tour!.summary).toBe(original);
  writeFileSync(source, JSON.stringify(changed));
  setUser(otherReviewer);
  await expect(
    harness.experimental_call("command", {
      dir,
      action: "write-tour",
      tour: ref.tourId,
      file: source,
    }),
  ).rejects.toThrow("author");
  setUser(tourAuthor);
  expect(
    (
      await harness.experimental_call("command", {
        dir,
        action: "write-tour",
        tour: ref.tourId,
        file: source,
      })
    ).valid,
  ).toBe(true);
  expect((await harness.experimental_call("review", { dir, ref })).tour!.summary).toBe(
    changed.summary,
  );
});
