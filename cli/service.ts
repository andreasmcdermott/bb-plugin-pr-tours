import { unchangedSections } from "../shared/changes.ts";
import { ownsTour, postedFindings } from "../shared/review.ts";
import { DraftSchema, formatZodError, type GitHubUser } from "../shared/schema.ts";
import { validateTour } from "../shared/validate.ts";
import type { ReviewResponse, ToursResponse } from "../viewer/api.ts";
import {
  latestRevision,
  listTours,
  loadDraft,
  loadPrepared,
  loadSnapshot,
  previousRevision,
  revisionContext,
  saveDraft,
  type RevisionEntry,
  type TourEntry,
} from "./review-dir.ts";

const CLI_ENTRY = "pr-tour";
const shellQuote = (value: string) =>
  /^[\w./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
export function toursResponse(dir: string, viewer: GitHubUser): ToursResponse {
  const { pr } = loadPrepared(dir);
  const tours = listTours(dir).map((entry) => {
    const { revision, meta, load } = latestRevision(entry);
    return {
      id: entry.id,
      meta: entry.meta,
      status: load.status,
      revision,
      headSha: meta.headSha,
      findings: load.status === "ok" ? load.tour.sections.flatMap((s) => s.findings).length : 0,
    };
  });
  const current = (headSha: string) => (headSha === pr.headSha ? 0 : 1);
  tours.sort((a, b) => current(a.headSha) - current(b.headSha));
  return { viewer, tours };
}

const command = (name: string, dir: string, tourId: string) =>
  `bun ${shellQuote(CLI_ENTRY)} ${name} ${shellQuote(dir)} --tour ${tourId}`;

export function reviewResponse(
  dir: string,
  entry: TourEntry,
  revision: RevisionEntry,
  viewer: GitHubUser,
): ReviewResponse {
  const live = loadPrepared(dir).pr;
  const { pr, files } = loadSnapshot(revision);
  const { load } = revision;
  const context = revisionContext(entry, revision);
  const previous = previousRevision(context);
  const tour = load.status === "ok" ? load.tour : null;
  return {
    dir,
    syncCommand: command("sync", dir, entry.id),
    reviseCommand: `bun ${shellQuote(CLI_ENTRY)} prepare ${shellQuote(pr.url)} --dir ${shellQuote(dir)} && ${command("revise", dir, entry.id)}`,
    pr,
    liveHeadSha: live.headSha,
    files,
    meta: entry.meta,
    revision: revision.meta,
    revisions: entry.revisions.map((r) => r.meta),
    isLatest: revision === latestRevision(entry),
    viewer,
    isAuthor: ownsTour(entry.meta.author, viewer),
    tour,
    tourErrors: load.status === "invalid" ? load.errors : [],
    validation: tour ? validateTour(tour, pr, files, previous) : null,
    previous:
      context.previous && context.previousTour
        ? { revision: context.previous.revision, tour: context.previousTour }
        : null,
    changes: context.changes,
    history: context.history,
    unchangedSections:
      tour && previous ? [...unchangedSections(tour, previous.changes, previous.tour)] : [],
  };
}

const conflict = (message: string) => Response.json({ errors: [message] }, { status: 409 });

export function handleDraftPut(
  entry: TourEntry,
  revision: RevisionEntry,
  viewer: GitHubUser,
  body: unknown,
): Response {
  const parsed = DraftSchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ errors: formatZodError(parsed.error) }, { status: 400 });
  const latest = latestRevision(entry);
  if (revision !== latest) {
    return conflict(`r${revision.revision} is read-only; the tour is at r${latest.revision}`);
  }
  if (parsed.data.headSha !== revision.meta.headSha) {
    return conflict("draft is for a different commit");
  }
  const decided = Object.keys(parsed.data.findings);
  if (decided.length > 0 && !ownsTour(entry.meta.author, viewer)) {
    return Response.json(
      { errors: [`only ${entry.meta.author.login} can decide on this tour's findings`] },
      { status: 403 },
    );
  }
  const { history } = revisionContext(entry, revision);
  const posted = postedFindings(history);
  const repeated = decided.filter((id) => posted.has(id));
  if (repeated.length > 0) {
    const ids = repeated.map((id) => `"${id}"`).join(", ");
    return conflict(`already posted in an earlier revision: ${ids}`);
  }
  const existing = loadDraft(revision, viewer);
  if (existing.synced) return conflict(`already posted to GitHub: ${existing.synced.url}`);
  saveDraft(revision, viewer, parsed.data);
  return Response.json(parsed.data);
}
