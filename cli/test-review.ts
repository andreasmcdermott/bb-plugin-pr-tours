import path from "node:path";
import type { DiffFile } from "../shared/diff.ts";
import { fixtureFiles, fixtureMeta, fixturePr, fixtureRevisionMeta } from "../shared/fixtures.ts";
import type { Changes, Draft, GitHubUser, PrMeta, TourMeta } from "../shared/schema.ts";
import { reviewFile, saveDraft, writeJson, writeRevision } from "./review-dir.ts";

export function writePrepared(
  dir: string,
  pr: PrMeta = fixturePr,
  files: DiffFile[] = fixtureFiles,
) {
  writeJson(path.join(dir, reviewFile.pr), pr);
  writeJson(path.join(dir, reviewFile.diff), files);
}

// Writes one revision of a tour the way new-tour and revise lay it out, and
// returns the revision directory.
export function writeTourRevision(
  dir: string,
  options: {
    meta?: TourMeta;
    revision?: number;
    pr?: PrMeta;
    files?: DiffFile[];
    changes?: Changes | null;
    tour?: unknown;
    draft?: Draft;
    reviewer?: GitHubUser;
  } = {},
): string {
  const { meta = fixtureMeta, revision = 1, pr = fixturePr, files = fixtureFiles } = options;
  const tourDir = path.join(dir, reviewFile.tours, meta.id);
  writeJson(path.join(tourDir, reviewFile.meta), meta);
  const entry = writeRevision(
    tourDir,
    fixtureRevisionMeta(revision, pr.headSha),
    { pr, files },
    options.changes ?? null,
  );
  if (options.tour !== undefined) writeJson(path.join(entry.dir, reviewFile.tour), options.tour);
  if (options.draft) saveDraft(entry, options.reviewer ?? meta.author, options.draft);
  return entry.dir;
}
