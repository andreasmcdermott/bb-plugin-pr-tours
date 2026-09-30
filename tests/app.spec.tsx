// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fixtureMeta, fixtureTour, tourAuthor } from "../shared/fixtures.ts";
import { writePrepared, writeTourRevision } from "../cli/test-review.ts";
import { resolveTour, latestRevision } from "../cli/review-dir.ts";
import { reviewResponse, toursResponse } from "../cli/service.ts";
import { emptyDraft } from "../shared/schema.ts";
import { buildReview } from "../shared/review.ts";

beforeEach(() => {
  vi.stubGlobal("CSS", { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&") });
});
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((fn) => fn());
  vi.restoreAllMocks();
});
async function setup(emptyTours = false, postWarnings: string[] = []) {
  const dir = mkdtempSync(path.join(tmpdir(), "pr-tours-ui-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  writePrepared(dir);
  writeTourRevision(dir, { tour: fixtureTour() });
  const tour = resolveTour(dir, fixtureMeta.id);
  const review = reviewResponse(dir, tour, latestRevision(tour), tourAuthor);
  const entry = {
    id: "review-1",
    hostId: "host-1",
    dir,
    threadId: "thread-1",
    title: review.pr.title,
    url: review.pr.url,
    updatedAt: new Date().toISOString(),
  };
  let savedDraft = emptyDraft(review.pr.headSha);
  const save = vi.fn(async ({ draft }) => {
    savedDraft = draft;
    return { draft, version: "saved" };
  });
  const preview = vi.fn(async () => ({
    token: "preview-1",
    viewer: tourAuthor,
    payload: buildReview(fixtureTour(), savedDraft, review.files, {
      author: tourAuthor,
      reviewer: tourAuthor,
    }).payload,
  }));
  const post = vi.fn(async () => {
    const url = "https://github.com/org/repo/pull/1#review-10";
    savedDraft = { ...savedDraft, synced: { at: new Date().toISOString(), url } };
    return { url, warnings: postWarnings };
  });
  const freshness = vi.fn(async () => ({
    headSha: review.pr.headSha,
    state: "open",
    checkedAt: new Date().toISOString(),
  }));
  const app = await loadPluginApp(() => import("../app.tsx"));
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "review-1" },
    {
      rpc: {
        list: () => [entry],
        tours: () =>
          emptyTours ? { viewer: tourAuthor, tours: [] } : toursResponse(dir, tourAuthor),
        review: () => review,
        draft: () => ({ draft: savedDraft, version: "initial" }),
        freshness,
        preview,
        post,
        save,
      },
    },
  );
  cleanups.push(() => slot.lifecycle.unmount());
  return { app, slot, save, review, preview, post, freshness };
}
it("renders the tour inside BB and saves a reviewer comment through RPC", async () => {
  const { slot, save } = await setup();
  await slot.findByRole("heading", { name: "Summary" });
  const summary = await slot.findByPlaceholderText("Review summary for the author");
  fireEvent.change(summary, { target: { value: "Looks good after checking callers." } });
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls.at(-1)![0].draft.body).toBe("Looks good after checking callers.");
  expect(slot.inspection.rpcCalls.filter((call) => call.method === "review")).toHaveLength(1);
});
it("downloads the reading export without navigating away from BB", async () => {
  const { slot } = await setup();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response("<html>standalone tour</html>", {
        headers: { "content-disposition": 'attachment; filename="review-tour.html"' },
      }),
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:tour"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  const clicks: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push(this.download);
  });
  const button = await slot.findByRole("button", { name: "Export HTML" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(clicks).toEqual(["review-tour.html"]));
  expect(fetchMock.mock.calls[0][0]).toBe(
    `/api/v1/plugins/pr-tours/http/export?id=review-1&tour=${fixtureMeta.id}`,
  );
  expect(slot.queryByRole("button", { name: "Export demo" })).toBeNull();
});
it("shows export failures and allows retry", async () => {
  const { slot } = await setup();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ error: "The review host is offline" }), { status: 400 }),
  );
  const button = await slot.findByRole("button", { name: "Export HTML" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  expect((await slot.findByRole("alert")).textContent).toContain("host is offline");
  expect((slot.getByRole("button", { name: "Export HTML" }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});

it("keeps the library navigation available before a tour has been written", async () => {
  const { slot } = await setup(true);
  await slot.findByText(/This PR has no tours yet/);
  expect(slot.getByRole("button", { name: "← All PRs" })).toBeTruthy();
});
it("waits for the trailing draft save before leaving the review", async () => {
  const { slot, save } = await setup();
  let release!: () => void;
  save.mockImplementationOnce(
    ({ draft }) =>
      new Promise((resolve) => {
        release = () => resolve({ draft, version: "saved" });
      }),
  );
  fireEvent.change(await slot.findByPlaceholderText("Review summary for the author"), {
    target: { value: "Keep this last edit" },
  });
  fireEvent.click(slot.getByRole("button", { name: "← All PRs" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(slot.inspection.navigateCalls).toHaveLength(0);
  release();
  await waitFor(() => expect(slot.inspection.navigateCalls).toHaveLength(1));
});

it("keeps failed edits on screen, retries them, and blocks leaving until saved", async () => {
  const { slot, save } = await setup();
  save.mockRejectedValueOnce(new Error("Host offline"));
  fireEvent.change(await slot.findByPlaceholderText("Review summary for the author"), {
    target: { value: "Keep these edits" },
  });
  fireEvent.click(slot.getByRole("button", { name: "← All PRs" }));
  await slot.findByRole("button", { name: "Retry save" });
  expect(slot.inspection.navigateCalls).toHaveLength(0);
  expect(
    (slot.getByPlaceholderText("Review summary for the author") as HTMLTextAreaElement).value,
  ).toBe("Keep these edits");
  fireEvent.click(slot.getByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][0].draft.body).toBe("Keep these edits");
});

it("previews the saved review and requires an explicit click to post", async () => {
  const warning = "The review was posted, but its comment links were not recorded.";
  const { slot, save, preview, post } = await setup(false, [warning]);
  fireEvent.change(await slot.findByPlaceholderText("Review summary for the author"), {
    target: { value: "Ready for review" },
  });
  fireEvent.click(slot.getByRole("radio", { name: "Approve" }));
  fireEvent.click(slot.getByRole("button", { name: "Mark ready for preview" }));
  fireEvent.click(await slot.findByRole("button", { name: "Preview GitHub review" }));
  await slot.findByRole("heading", { name: `Post as ${tourAuthor.login}` });
  expect(save.mock.calls.at(-1)![0].draft.readyAt).toBeTruthy();
  expect(preview).toHaveBeenCalledTimes(1);
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(slot.getByRole("button", { name: "Post to GitHub" }));
  await slot.findByRole("link", { name: "View on GitHub" });
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({ token: "preview-1", viewerId: tourAuthor.id }),
  );
  await waitFor(() =>
    expect(slot.queryByPlaceholderText("Review summary for the author")).toBeNull(),
  );
  expect(slot.queryByRole("button", { name: "Keep editing" })).toBeNull();
  expect(slot.getByText("Ready for review")).toBeTruthy();
  expect(slot.getByText(warning)).toBeTruthy();
  expect(save.mock.calls.at(-1)![0].draft.body).toBe("Ready for review");
});
it.each(["finding", "comment"])("allows posting an inline %s without a summary", async (source) => {
  const { slot, preview, post } = await setup();
  if (source === "finding") {
    fireEvent.click((await slot.findAllByRole("button", { name: "Accept" }))[0]!);
  } else {
    fireEvent.click((await slot.findAllByRole("button", { name: "Comment on this line" }))[0]!);
    fireEvent.change(await slot.findByPlaceholderText("Leave a comment for the author…"), {
      target: { value: "Please check this line." },
    });
  }
  fireEvent.click(slot.getByRole("radio", { name: /^Comment$/ }));
  const ready = slot.getByRole("button", { name: "Mark ready for preview" });
  expect((ready as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(ready);
  fireEvent.click(await slot.findByRole("button", { name: "Preview GitHub review" }));
  await slot.findByText("No review summary.");
  expect((await preview.mock.results[0]!.value).payload).toMatchObject({
    event: "COMMENT",
    body: "",
    comments: [expect.objectContaining({ path: "src/app.ts" })],
  });
  fireEvent.click(slot.getByRole("button", { name: "Post to GitHub" }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(slot.queryByPlaceholderText("Review summary for the author")).toBeNull(),
  );
});
it("keeps the summary when posting fails", async () => {
  const { slot, post } = await setup();
  post.mockRejectedValueOnce(new Error("GitHub unavailable"));
  fireEvent.change(await slot.findByPlaceholderText("Review summary for the author"), {
    target: { value: "Keep my review" },
  });
  fireEvent.click(slot.getByRole("radio", { name: "Approve" }));
  fireEvent.click(slot.getByRole("button", { name: "Mark ready for preview" }));
  fireEvent.click(await slot.findByRole("button", { name: "Preview GitHub review" }));
  fireEvent.click(await slot.findByRole("button", { name: "Post to GitHub" }));
  await slot.findByText("GitHub unavailable");
  expect(
    (slot.getByPlaceholderText("Review summary for the author") as HTMLTextAreaElement).value,
  ).toBe("Keep my review");
});

it("shows live GitHub updates without changing the reviewed snapshot", async () => {
  const { slot, freshness, review } = await setup();
  await slot.findByRole("button", { name: "Check GitHub" });
  freshness.mockResolvedValue({
    headSha: "newer-commit",
    state: "open",
    checkedAt: new Date().toISOString(),
  });
  fireEvent.click(slot.getByRole("button", { name: "Check GitHub" }));
  await slot.findByText(/Update the tour to review the new commits/);
  expect(review.pr.headSha).toBe("head111");
});

it("announces agent updates without replacing pending edits", async () => {
  const { slot } = await setup();
  const summary = await slot.findByPlaceholderText("Review summary for the author");
  fireEvent.change(summary, { target: { value: "Still writing this" } });
  await slot.behavior.emitRealtime("tours-changed", { id: "review-1" });
  await slot.findByText("Tour updated. Refresh to load it.");
  expect((summary as HTMLTextAreaElement).value).toBe("Still writing this");
  expect(slot.inspection.rpcCalls.filter((call) => call.method === "review")).toHaveLength(1);
});

it("searches the library and archives and restores reviews", async () => {
  const app = await loadPluginApp(() => import("../app.tsx"));
  let archived = false;
  const entry = {
    id: "r1",
    hostId: "h1",
    dir: "/reviews/1",
    threadId: null,
    title: "Add search",
    url: "https://github.com/org/repo/pull/12",
    updatedAt: new Date().toISOString(),
    archived,
  };
  const archive = vi.fn(({ archived: value }) => {
    archived = value;
    return null;
  });
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "" },
    {
      rpc: {
        list: (input) =>
          Boolean((input as { archived?: boolean }).archived) === archived
            ? [{ ...entry, archived }]
            : [],
        progress: () => ({ status: "in-progress", viewed: 2, total: 3 }),
        archive,
      },
    },
  );
  cleanups.push(() => slot.lifecycle.unmount());
  await slot.findByText("In progress · 2/3 sections viewed");
  fireEvent.change(slot.getByRole("textbox", { name: "Search reviews" }), {
    target: { value: "no-match" },
  });
  await slot.findByText("No matching reviews.");
  fireEvent.change(slot.getByRole("textbox", { name: "Search reviews" }), {
    target: { value: "repo/pull/12" },
  });
  fireEvent.click(await slot.findByRole("button", { name: "Archive" }));
  await waitFor(() => expect(archive).toHaveBeenCalledWith({ id: "r1", archived: true }));
  fireEvent.click(slot.getByRole("checkbox", { name: "Show archived reviews" }));
  fireEvent.click(await slot.findByRole("button", { name: "Restore" }));
  await waitFor(() => expect(archive).toHaveBeenLastCalledWith({ id: "r1", archived: false }));
});
