import type { Draft } from "../shared/schema.ts";
export type SaveState =
  | { status: "saved" }
  | { status: "saving" }
  | { status: "error"; message: string };

// One in-flight write per mounted revision. A later response can never overwrite
// a newer draft; navigation flushes the trailing edit instead of dropping it.
export function createDraftSaver(
  initial: Draft,
  save: (draft: Draft) => Promise<unknown>,
  report: (state: SaveState) => void,
  delay = 400,
) {
  let cancelled = false;
  let last = JSON.stringify(initial);
  let pending: Draft | undefined;
  let active: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function flush(): Promise<void> {
    clearTimeout(timer);
    if (cancelled) return;
    if (active) {
      await active;
      return flush();
    }
    if (!pending) return;
    const next = pending;
    pending = undefined;
    report({ status: "saving" });
    active = (async () => {
      try {
        await save(next);
        last = JSON.stringify(next);
      } catch (error) {
        if (!cancelled) pending ??= next;
        report({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    })();
    try {
      await active;
    } finally {
      active = undefined;
    }
    if (pending) return flush();
    report({ status: "saved" });
  }
  return {
    cancel() {
      cancelled = true;
      pending = undefined;
      clearTimeout(timer);
      return active?.catch(() => {}) ?? Promise.resolve();
    },
    enqueue(draft: Draft) {
      if (cancelled) return;
      if (!active && !pending && JSON.stringify(draft) === last) return;
      pending = draft;
      report({ status: "saving" });
      clearTimeout(timer);
      timer = setTimeout(() => {
        void flush().catch(() => {});
      }, delay);
    },
    flush,
  };
}
