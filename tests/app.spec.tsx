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
async function setup(emptyTours = false) {
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
  const save = vi.fn(({ draft }) => draft);
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
        draft: () => emptyDraft(review.pr.headSha),
        save,
      },
    },
  );
  cleanups.push(() => slot.lifecycle.unmount());
  return { app, slot, save, review };
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
        release = () => resolve(draft);
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
