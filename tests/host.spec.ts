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
function setup(responses: Record<string, string | (() => string)> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "bb-pr-tours-test-"));
  dirs.push(root);
  const dir = path.join(root, "source");
  writePrepared(dir);
  writeTourRevision(dir, { tour: fixtureTour() });
  let user = tourAuthor;
  const run = fakeGh({ "api user": () => JSON.stringify(user), ...responses });
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
    await harness.experimental_call("save", {
      dir,
      ref,
      draft,
      viewerId: tourAuthor.id,
      expectedVersion: (await harness.experimental_call("draft", { dir, ref })).version,
    });
    expect((await harness.experimental_call("draft", { dir, ref })).draft.body).toBe(
      "My private review",
    );
    setUser(otherReviewer);
    await expect(
      harness.experimental_call("save", {
        dir,
        ref,
        draft,
        viewerId: tourAuthor.id,
        expectedVersion: (await harness.experimental_call("draft", { dir, ref })).version,
      }),
    ).rejects.toThrow("account");
    await expect(
      harness.experimental_call("save", {
        dir,
        ref,
        draft,
        viewerId: otherReviewer.id,
        expectedVersion: (await harness.experimental_call("draft", { dir, ref })).version,
      }),
    ).rejects.toThrow("only");
    expect((await harness.experimental_call("draft", { dir, ref })).draft.body).toBe("");
  });
  it("exports a reading copy with no private drafts", async () => {
    const { harness, dir } = setup();
    const draft = fixtureDraft({
      body: "Do not export this",
      comments: [
        { id: "private", path: "src/app.ts", side: "RIGHT", line: 21, body: "Private comment" },
      ],
    });
    await harness.experimental_call("save", {
      dir,
      ref,
      draft,
      viewerId: tourAuthor.id,
      expectedVersion: (await harness.experimental_call("draft", { dir, ref })).version,
    });
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

it("rejects stale saves from a second view instead of overwriting the first", async () => {
  const { harness, dir } = setup();
  const initial = await harness.experimental_call("draft", { dir, ref });
  const version = initial.version;
  const save = (draft: ReturnType<typeof fixtureDraft>) =>
    harness.experimental_call("save", {
      dir,
      ref,
      draft,
      viewerId: tourAuthor.id,
      expectedVersion: version,
    });
  await save(fixtureDraft({ body: "First view's comment" }));
  await expect(save(fixtureDraft({ event: "APPROVE" }))).rejects.toThrow(/changed in another view/);
});

it("checks GitHub freshness without changing the pinned review snapshot", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "pr-tours-freshness-"));
  dirs.push(root);
  writePrepared(root);
  writeTourRevision(root, { tour: fixtureTour() });
  const run = fakeGh({
    "api user": JSON.stringify(tourAuthor),
    "api repos/useshortcut/monorepo/pulls/42": JSON.stringify({
      head: { sha: "new-head" },
      state: "closed",
    }),
  });
  const harness = experimental_createHostEntryHarness(createHostEntry(run));
  disposers.push(() => harness.experimental_dispose());
  expect(await harness.experimental_call("freshness", { dir: root })).toMatchObject({
    headSha: "new-head",
    state: "closed",
  });
  expect((await harness.experimental_call("review", { dir: root, ref })).pr.headSha).toBe(
    fixturePr.headSha,
  );
});

it("transfers a review larger than 8 MiB as an immutable snapshot", async () => {
  const { harness, dir } = setup();
  const summary = "Large tour 🚀 ".repeat(650_000);
  writeTourRevision(dir, { tour: fixtureTour({ summary }) });
  await expect(harness.experimental_call("review", { dir, ref })).rejects.toThrow();
  const snapshot = await harness.experimental_call("snapshot", { dir, ref, kind: "review" });
  writeTourRevision(dir, { tour: fixtureTour({ summary: "Changed while loading" }) });
  const chunks: Buffer[] = [];
  for (let index = 0; index < snapshot.chunks; index++) {
    const chunk = await harness.experimental_call("chunk", { token: snapshot.token, index });
    expect(chunk.length).toBeLessThan(512 * 1024);
    chunks.push(Buffer.from(chunk, "base64"));
  }
  expect(JSON.parse(Buffer.concat(chunks).toString("utf8")).tour.summary).toBe(summary);
  await harness.experimental_call("release", { token: snapshot.token });
  await expect(
    harness.experimental_call("chunk", { token: snapshot.token, index: 0 }),
  ).rejects.toThrow(/expired/);
});

it("posts only the previewed draft and account, rejects stale previews and duplicate posts", async () => {
  const { harness, dir, run, setUser } = setup({
    "api repos/useshortcut/monorepo/pulls/42": JSON.stringify({
      state: "open",
      head: { sha: fixturePr.headSha },
      user: { login: "someone-else" },
    }),
    "api --method POST repos/useshortcut/monorepo/pulls/42/reviews --input -": JSON.stringify({
      id: 100,
      html_url: "https://github.com/org/repo/pull/42#review-100",
    }),
  });
  const draft = fixtureDraft({
    body: "Checked the callers",
    event: "APPROVE",
    readyAt: new Date().toISOString(),
  });
  const initial = await harness.experimental_call("draft", { dir, ref });
  const saved = await harness.experimental_call("save", {
    dir,
    ref,
    draft,
    viewerId: tourAuthor.id,
    expectedVersion: initial.version,
  });
  const preview = await harness.experimental_call("preview", { dir, ref, viewerId: tourAuthor.id });
  expect(preview.viewer).toEqual(tourAuthor);
  expect(preview.payload.body).toContain("Checked the callers");
  expect(run.calls.some((call) => call.args.includes("POST"))).toBe(false);
  setUser(otherReviewer);
  await expect(
    harness.experimental_call("post", { dir, ref, viewerId: tourAuthor.id, token: preview.token }),
  ).rejects.toThrow(/account/);
  setUser(tourAuthor);
  await harness.experimental_call("save", {
    dir,
    ref,
    draft: { ...draft, body: "Changed since preview" },
    viewerId: tourAuthor.id,
    expectedVersion: saved.version,
  });
  await expect(
    harness.experimental_call("post", { dir, ref, viewerId: tourAuthor.id, token: preview.token }),
  ).rejects.toThrow(/review changed/);
  expect(run.calls.some((call) => call.args.includes("POST"))).toBe(false);
  const latest = await harness.experimental_call("preview", { dir, ref, viewerId: tourAuthor.id });
  const result = await harness.experimental_call("post", {
    dir,
    ref,
    viewerId: tourAuthor.id,
    token: latest.token,
  });
  expect(result.url).toContain("review-100");
  await expect(
    harness.experimental_call("post", { dir, ref, viewerId: tourAuthor.id, token: latest.token }),
  ).rejects.toThrow(/already posted/);
  expect(run.calls.filter((call) => call.args.includes("POST"))).toHaveLength(1);
  expect((await harness.experimental_call("draft", { dir, ref })).draft.synced?.url).toBe(
    result.url,
  );
});
