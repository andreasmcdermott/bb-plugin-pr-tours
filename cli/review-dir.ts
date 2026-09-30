import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { seedViewedSections } from "../shared/changes.ts";
import type { DiffFile } from "../shared/diff.ts";
import { findingHistory, type FindingHistory } from "../shared/review.ts";
import type { PreviousRevision } from "../shared/validate.ts";
import {
  ChangesSchema,
  DraftSchema,
  PrMetaSchema,
  RevisionMetaSchema,
  TourMetaSchema,
  TourSchema,
  emptyDraft,
  formatZodError,
  type Changes,
  type Draft,
  type GitHubUser,
  type PrMeta,
  type RevisionMeta,
  type Tour,
  type TourMeta,
} from "../shared/schema.ts";

export function reviewsRoot(env: Record<string, string | undefined> = process.env): string {
  return env.PR_TOUR_HOME || path.join(homedir(), "pr-tours");
}

export type PrRef = { owner: string; repo: string; number: number };

export function parsePrRef(ref: string): PrRef {
  const match =
    /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/.exec(ref) ??
    /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(ref);
  if (!match) throw new Error(`expected a PR URL or owner/repo#number, got "${ref}"`);
  return { owner: match[1]!, repo: match[2]!, number: Number(match[3]) };
}

// Commands take a review by path, by PR, or by its directory name under the root.
export function resolveReviewDir(
  target: string,
  root = reviewsRoot(),
  cwd = process.cwd(),
): string {
  const local = path.resolve(cwd, target);
  if (statSync(local, { throwIfNoEntry: false })?.isDirectory()) return local;
  try {
    return defaultReviewDir(parsePrRef(target), root);
  } catch {
    return path.resolve(root, target);
  }
}

export const reviewFile = {
  pr: "pr.json",
  patch: "diff.patch",
  diff: "diff.json",
  tours: "tours",
  revisions: "revisions",
  meta: "meta.json",
  revision: "revision.json",
  changes: "changes.json",
  tour: "tour.json",
  drafts: "drafts",
} as const;

export function defaultReviewDir(pr: PrRef, root = reviewsRoot()): string {
  return path.join(root, `${pr.owner}-${pr.repo}-${pr.number}`);
}

export function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

export type Prepared = { pr: PrMeta; files: DiffFile[] };

export function loadPrepared(dir: string): Prepared {
  const prFile = path.join(dir, reviewFile.pr);
  if (!existsSync(prFile)) {
    throw new Error(`${dir} has no ${reviewFile.pr}; run \`pr-tour prepare <pr>\` first`);
  }
  const pr = PrMetaSchema.parse(readJson(prFile));
  const files = readJson(path.join(dir, reviewFile.diff)) as DiffFile[];
  return { pr, files };
}

export type TourLoad =
  | { status: "missing" }
  | { status: "invalid"; errors: string[] }
  | { status: "ok"; tour: Tour };

export type RevisionEntry = { revision: number; dir: string; meta: RevisionMeta; load: TourLoad };

export type TourEntry = { id: string; dir: string; meta: TourMeta; revisions: RevisionEntry[] };

function listRevisions(tourDir: string): RevisionEntry[] {
  const root = path.join(tourDir, reviewFile.revisions);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[1-9]\d*$/.test(entry.name))
    .flatMap((entry) => {
      const dir = path.join(root, entry.name);
      const file = path.join(dir, reviewFile.revision);
      if (!existsSync(file)) return [];
      const meta = RevisionMetaSchema.parse(readJson(file));
      return [{ revision: meta.revision, dir, meta, load: loadTour(dir) }];
    })
    .sort((a, b) => a.revision - b.revision);
}

export function listTours(reviewDir: string): TourEntry[] {
  const root = path.join(reviewDir, reviewFile.tours);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const dir = path.join(root, entry.name);
      const metaFile = path.join(dir, reviewFile.meta);
      if (!existsSync(metaFile)) return [];
      const meta = TourMetaSchema.parse(readJson(metaFile));
      const revisions = listRevisions(dir);
      return revisions.length > 0 ? [{ id: meta.id, dir, meta, revisions }] : [];
    })
    .sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
}

export function latestRevision(entry: TourEntry): RevisionEntry {
  return entry.revisions.at(-1)!;
}

export function resolveTour(reviewDir: string, id?: string): TourEntry {
  const tours = listTours(reviewDir);
  const ids = tours.map((tour) => tour.id).join(", ");
  if (id) {
    const match = tours.find((tour) => tour.id === id);
    if (!match) throw new Error(`no tour "${id}" in ${reviewDir}; tours: ${ids || "none"}`);
    return match;
  }
  if (tours.length === 1) return tours[0]!;
  if (tours.length === 0) {
    throw new Error(`${reviewDir} has no tours yet; run \`pr-tour new-tour ${reviewDir}\``);
  }
  throw new Error(`${reviewDir} has ${tours.length} tours; pass --tour with one of: ${ids}`);
}

export function resolveRevision(entry: TourEntry, revision?: number): RevisionEntry {
  if (revision === undefined) return latestRevision(entry);
  const match = entry.revisions.find((r) => r.revision === revision);
  if (!match) {
    const known = entry.revisions.map((r) => r.revision).join(", ");
    throw new Error(`tour ${entry.id} has no revision ${revision}; revisions: ${known}`);
  }
  return match;
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^[-.]+|-+$/g, "");

export function writeRevision(
  tourDir: string,
  meta: RevisionMeta,
  prepared: Prepared,
  changes: Changes | null,
): RevisionEntry {
  const dir = path.join(tourDir, reviewFile.revisions, String(meta.revision));
  writeJson(path.join(dir, reviewFile.pr), prepared.pr);
  writeJson(path.join(dir, reviewFile.diff), prepared.files);
  if (changes) writeJson(path.join(dir, reviewFile.changes), changes);
  writeJson(path.join(dir, reviewFile.revision), RevisionMetaSchema.parse(meta));
  return { revision: meta.revision, dir, meta, load: { status: "missing" } };
}

export function createTour(
  reviewDir: string,
  options: { model: string; agent?: string; author: GitHubUser; now?: Date },
): TourEntry {
  const prepared = loadPrepared(reviewDir);
  const { headSha } = prepared.pr;
  const base = `${slug(options.model) || "tour"}-${headSha.slice(0, 7)}`;
  const taken = new Set(listTours(reviewDir).map((tour) => tour.id));
  let id = base;
  for (let n = 2; taken.has(id) || existsSync(path.join(reviewDir, reviewFile.tours, id)); n++) {
    id = `${base}-${n}`;
  }
  const createdAt = (options.now ?? new Date()).toISOString();
  const meta = TourMetaSchema.parse({
    id,
    author: options.author,
    model: options.model,
    agent: options.agent,
    createdAt,
  });
  const dir = path.join(reviewDir, reviewFile.tours, id);
  writeJson(path.join(dir, reviewFile.meta), meta);
  const first = writeRevision(
    dir,
    { revision: 1, headSha, model: options.model, agent: options.agent, createdAt },
    prepared,
    null,
  );
  return { id, dir, meta, revisions: [first] };
}

export function loadTour(dir: string): TourLoad {
  const file = path.join(dir, reviewFile.tour);
  if (!existsSync(file)) return { status: "missing" };
  let raw: unknown;
  try {
    raw = readJson(file);
  } catch (error) {
    return {
      status: "invalid",
      errors: [`${reviewFile.tour} is not valid JSON: ${String(error)}`],
    };
  }
  const parsed = TourSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid", errors: formatZodError(parsed.error) };
  return { status: "ok", tour: parsed.data };
}

export function loadSnapshot(revision: RevisionEntry): Prepared {
  return loadPrepared(revision.dir);
}

export function loadChanges(revision: RevisionEntry): Changes | null {
  const file = path.join(revision.dir, reviewFile.changes);
  return existsSync(file) ? ChangesSchema.parse(readJson(file)) : null;
}

type Reviewer = Pick<GitHubUser, "id">;

export const draftFile = (revisionDir: string, reviewer: Reviewer) =>
  path.join(revisionDir, reviewFile.drafts, `${reviewer.id}.json`);

export function draftExists(revision: RevisionEntry, reviewer: Reviewer): boolean {
  return existsSync(draftFile(revision.dir, reviewer));
}

export function loadDraft(revision: RevisionEntry, reviewer: Reviewer): Draft {
  const { headSha } = revision.meta;
  const file = draftFile(revision.dir, reviewer);
  if (!existsSync(file)) return emptyDraft(headSha);
  const draft = DraftSchema.parse(readJson(file));
  if (draft.headSha !== headSha) {
    const name = path.relative(revision.dir, file);
    throw new Error(`${name} was written for ${draft.headSha}, not ${headSha}`);
  }
  return draft;
}

export function saveDraft(revision: RevisionEntry, reviewer: Reviewer, draft: Draft) {
  writeJson(draftFile(revision.dir, reviewer), draft);
}

export type RevisionContext = {
  previous: RevisionEntry | null;
  previousTour: Tour | null;
  changes: Changes | null;
  history: Record<string, FindingHistory>;
};

export function revisionContext(entry: TourEntry, revision: RevisionEntry): RevisionContext {
  const earlier = entry.revisions.filter((r) => r.revision < revision.revision);
  const previous = earlier.at(-1) ?? null;
  const { author } = entry.meta;
  return {
    previous,
    previousTour: previous?.load.status === "ok" ? previous.load.tour : null,
    changes: loadChanges(revision),
    history: findingHistory(
      earlier.map((r) => ({
        revision: r.revision,
        draft: draftExists(r, author) ? loadDraft(r, author) : null,
      })),
    ),
  };
}

export function previousRevision(context: RevisionContext): PreviousRevision | null {
  const { previousTour, changes } = context;
  return previousTour && changes ? { tour: previousTour, changes } : null;
}

// A new revision starts with a fresh draft, but sections the reviewer already
// read that did not change stay marked as viewed.
export function seedDraft(
  revision: RevisionEntry,
  context: RevisionContext,
  reviewer: Reviewer,
): Draft {
  const draft = emptyDraft(revision.meta.headSha);
  const { previous, previousTour, changes } = context;
  if (revision.load.status !== "ok" || !previous || !previousTour || !changes) return draft;
  if (!draftExists(previous, reviewer)) return draft;
  const viewedSections = seedViewedSections(revision.load.tour, changes, {
    tour: previousTour,
    draft: loadDraft(previous, reviewer),
  });
  return { ...draft, viewedSections };
}

export function loadOrSeedDraft(
  revision: RevisionEntry,
  context: RevisionContext,
  reviewer: Reviewer,
): Draft {
  return draftExists(revision, reviewer)
    ? loadDraft(revision, reviewer)
    : seedDraft(revision, context, reviewer);
}
