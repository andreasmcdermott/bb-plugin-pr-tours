import { expect, it, vi } from "vitest";
import { createDraftSaver } from "../viewer/autosave.ts";
import { fixtureDraft } from "../shared/fixtures.ts";
it("flushes the last edit when navigating before the debounce expires", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const saver = createDraftSaver(fixtureDraft(), save, () => {});
  saver.enqueue(fixtureDraft({ body: "First" }));
  saver.enqueue(fixtureDraft({ body: "Final" }));
  await saver.flush();
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0].body).toBe("Final");
});
it("serializes writes so an older response cannot replace a newer edit", async () => {
  let release!: () => void;
  const first = new Promise<void>((resolve) => {
    release = resolve;
  });
  const save = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
  const report = vi.fn();
  const saver = createDraftSaver(fixtureDraft(), save, report);
  saver.enqueue(fixtureDraft({ body: "First" }));
  const flush = saver.flush();
  saver.enqueue(fixtureDraft({ body: "Final" }));
  expect(save).toHaveBeenCalledTimes(1);
  release();
  await flush;
  expect(save.mock.calls.map((call) => call[0].body)).toEqual(["First", "Final"]);
  expect(report).toHaveBeenLastCalledWith({ status: "saved" });
});

it("retains a failed edit so navigation retries instead of losing it", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
  const saver = createDraftSaver(fixtureDraft(), save, () => {});
  saver.enqueue(fixtureDraft({ body: "Keep this" }));
  await expect(saver.flush()).rejects.toThrow("Offline");
  await saver.flush();
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0].body).toBe("Keep this");
});
