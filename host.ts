import { TourSchema } from "./shared/schema.ts";
import { ownsTour } from "./shared/review.ts";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract } from "./host-contract.ts";
import { currentUser, gh, type Gh } from "./cli/gh.ts";
import { prepare } from "./cli/prepare.ts";
import {
  createTour,
  loadDraft,
  writeJson,
  defaultReviewDir,
  latestRevision,
  loadOrSeedDraft,
  loadPrepared,
  loadSnapshot,
  parsePrRef,
  previousRevision,
  resolveRevision,
  resolveTour,
  revisionContext,
} from "./cli/review-dir.ts";
import { reviewResponse, toursResponse, handleDraftPut } from "./cli/service.ts";
import { staticData } from "./cli/static-data.ts";
import { revise } from "./cli/revise.ts";
import { sync } from "./cli/sync.ts";
import { validateTour } from "./shared/validate.ts";

// Files live on the daemon's machine, independent of checkouts and thread cleanup.
// Serializing writes also prevents simultaneous UI/CLI syncs from posting twice.
const queues = new Map<string, Promise<unknown>>();
async function exclusive<T>(dir: string, action: () => Promise<T>): Promise<T> {
  const key = path.resolve(dir);
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  queues.set(key, next);
  try {
    return await next;
  } finally {
    if (queues.get(key) === next) queues.delete(key);
  }
}
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function createHostEntry(run: Gh = gh) {
  return experimental_defineHostEntry({
    contract: hostContract,
    handlers: {
      async prepare(input, ctx) {
        const dir =
          input.dir ??
          defaultReviewDir(
            parsePrRef(input.ref),
            path.join(ctx.experimental_paths.dataDir, "reviews"),
          );
        return exclusive(dir, async () => {
          const result = await prepare({ gh: run, ref: input.ref, dir });
          return { dir: result.dir, pr: result.pr, warnings: result.warnings };
        });
      },
      async import(input, ctx) {
        if (!path.isAbsolute(input.dir))
          throw new Error("Import requires an absolute directory path on the selected host");
        const source = realpathSync(input.dir);
        const { pr } = loadPrepared(source);
        const dir = defaultReviewDir(pr, path.join(ctx.experimental_paths.dataDir, "reviews"));
        return exclusive(dir, async () => {
          if (source !== dir) {
            if (existsSync(dir))
              throw new Error(
                "This PR already exists in plugin storage. Use its library entry instead of overwriting reviews.",
              );
            mkdirSync(path.dirname(dir), { recursive: true });
            cpSync(source, dir, { recursive: true });
          }
          return { dir, pr };
        });
      },
      async tours({ dir }) {
        return clean(toursResponse(dir, await currentUser(run)));
      },
      async review({ dir, ref }) {
        const tour = resolveTour(dir, ref.tourId);
        return clean(
          reviewResponse(dir, tour, resolveRevision(tour, ref.revision), await currentUser(run)),
        );
      },
      async draft({ dir, ref }) {
        const tour = resolveTour(dir, ref.tourId),
          revision = resolveRevision(tour, ref.revision);
        return clean(
          loadOrSeedDraft(revision, revisionContext(tour, revision), await currentUser(run)),
        );
      },
      async save({ dir, ref, draft, viewerId }) {
        return exclusive(dir, async () => {
          const viewer = await currentUser(run);
          if (viewer.id !== viewerId)
            throw new Error(
              "The GitHub account on this machine changed. Reload the tour before editing.",
            );
          const tour = resolveTour(dir, ref.tourId);
          const response = handleDraftPut(tour, resolveRevision(tour, ref.revision), viewer, draft);
          const body = await response.json();
          if (!response.ok) throw new Error(body.errors.join("\n"));
          return body;
        });
      },
      async export({ dir, tourId }) {
        return clean(staticData(dir, { tour: tourId }));
      },
      async command(input) {
        return exclusive(input.dir, async () => {
          const { dir, action, tour, model, agent } = input;
          if (action === "new-tour") {
            if (!model?.trim())
              throw new Error("Pass --model with the model actually writing the tour");
            const entry = createTour(dir, { model, agent, author: await currentUser(run) });
            return {
              valid: true,
              text: `Tour ${entry.id}\nDestination: ${path.join(latestRevision(entry).dir, "tour.json")}\nAuthor tour.json in thread storage, then run bb pr-tours write-tour <review-id> --tour ${entry.id} --file /absolute/path/to/tour.json\nRead ${path.join(dir, "pr.json")} and ${path.join(dir, "diff.json")} for the pinned snapshot and hunk IDs.`,
            };
          }
          if (action === "revise") {
            const result = await revise({ gh: run, dir, tour, model, agent });
            return {
              valid: true,
              text: `Destination: ${path.join(result.revision.dir, "tour.json")}\nAuthor the revised JSON in thread storage, then run bb pr-tours write-tour <review-id> --tour ${result.entry.id} --file /absolute/path/to/tour.json\nChanges: ${path.join(result.revision.dir, "changes.json")}\nPrevious findings: ${result.openFindings.join(", ")}`,
            };
          }
          if (action === "write-tour") {
            if (!input.file || !path.isAbsolute(input.file))
              throw new Error(
                "Pass --file with an absolute path to the authored tour JSON on this machine",
              );
            const entry = resolveTour(dir, tour),
              revision = latestRevision(entry);
            const viewer = await currentUser(run);
            if (!ownsTour(entry.meta.author, viewer))
              throw new Error("Only the tour's author can write its content");
            const draft = loadDraft(revision, viewer);
            if (draft.synced || draft.readyAt)
              throw new Error(
                "Reopen the draft before changing a ready tour; posted revisions cannot be rewritten",
              );
            const content = TourSchema.parse(JSON.parse(readFileSync(input.file, "utf8")));
            const snapshot = loadSnapshot(revision);
            const validation = validateTour(
              content,
              snapshot.pr,
              snapshot.files,
              previousRevision(revisionContext(entry, revision)),
            );
            if (validation.errors.length > 0)
              return { valid: false, text: JSON.stringify(validation, null, 2) };
            writeJson(path.join(revision.dir, "tour.json"), content);
            return {
              valid: true,
              text: `Saved and validated ${entry.id} r${revision.revision}\n${JSON.stringify(validation, null, 2)}`,
            };
          }
          if (action === "sync") {
            const result = await sync({ gh: run, dir, tour, dryRun: input.dryRun });
            return { valid: true, text: JSON.stringify(result, null, 2) };
          }
          const entry = resolveTour(dir, tour),
            revision = latestRevision(entry);
          if (revision.load.status !== "ok")
            return {
              valid: false,
              text:
                revision.load.status === "invalid"
                  ? revision.load.errors.join("\n")
                  : "tour.json is missing",
            };
          const snapshot = loadSnapshot(revision);
          const validation = validateTour(
            revision.load.tour,
            snapshot.pr,
            snapshot.files,
            previousRevision(revisionContext(entry, revision)),
          );
          return {
            valid: validation.errors.length === 0,
            text: JSON.stringify(validation, null, 2),
          };
        });
      },
    },
  });
}
export default createHostEntry();
