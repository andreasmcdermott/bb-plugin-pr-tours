import { buildReview, postedFindings, type ReviewPayload } from "../shared/review.ts";
import type { Draft } from "../shared/schema.ts";
import { currentUser, ghJson, type Gh } from "./gh.ts";
import {
  latestRevision,
  loadDraft,
  loadSnapshot,
  resolveTour,
  reviewFile,
  revisionContext,
  saveDraft,
} from "./review-dir.ts";

type PullState = { state: string; head: { sha: string }; user: { login: string } };

type PostedComment = {
  id: number;
  path: string;
  side?: "LEFT" | "RIGHT";
  line: number | null;
  original_line?: number | null;
  body: string;
  html_url: string;
};

export type SyncResult =
  | { status: "dry-run"; payload: ReviewPayload }
  | { status: "posted"; payload: ReviewPayload; url: string; warnings: string[] };

type SyncedComments = NonNullable<NonNullable<Draft["synced"]>["comments"]>;

export function matchPostedComments(
  payload: ReviewPayload,
  sources: string[],
  posted: PostedComment[],
): SyncedComments {
  const unused = [...posted];
  return payload.comments.flatMap((comment, i) => {
    const index = unused.findIndex(
      (candidate) =>
        candidate.path === comment.path &&
        (candidate.side ?? comment.side) === comment.side &&
        (candidate.line ?? candidate.original_line) === comment.line &&
        candidate.body.trim() === comment.body.trim(),
    );
    if (index === -1) return [];
    const [match] = unused.splice(index, 1);
    return [{ source: sources[i]!, githubId: match!.id, url: match!.html_url }];
  });
}

export async function sync(options: {
  gh: Gh;
  dir: string;
  tour?: string;
  dryRun?: boolean;
  expectedReviewerId?: number;
  expectedPayload?: ReviewPayload;
  allowOutdated?: boolean;
  force?: boolean;
  now?: () => Date;
}): Promise<SyncResult> {
  const entry = resolveTour(options.dir, options.tour);
  const revision = latestRevision(entry);
  const label = `tour ${entry.id} r${revision.revision}`;
  if (revision.load.status !== "ok") {
    throw new Error(
      `${reviewFile.tour} for ${label} must exist and be valid before syncing; run \`pr-tour validate\``,
    );
  }
  const { pr, files } = loadSnapshot(revision);
  const reviewer = await currentUser(options.gh);
  if (options.expectedReviewerId !== undefined && reviewer.id !== options.expectedReviewerId)
    throw new Error("The GitHub account changed. Preview the review again.");
  const draft = loadDraft(revision, reviewer);

  if (draft.synced && !options.force) {
    throw new Error(
      `this review was already posted at ${draft.synced.url}; pass --force to post again`,
    );
  }
  if (!draft.readyAt) {
    throw new Error("the review is not finished; use “Mark ready to sync” in the viewer first");
  }

  const { history } = revisionContext(entry, revision);
  const { payload, sources } = buildReview(
    revision.load.tour,
    draft,
    files,
    { author: entry.meta.author, reviewer },
    postedFindings(history),
  );
  const repoPath = `repos/${pr.owner}/${pr.repo}`;
  const current = await ghJson<PullState>(options.gh, ["api", `${repoPath}/pulls/${pr.number}`]);

  if (current.state !== "open") throw new Error(`the PR is ${current.state}`);
  if (current.head.sha !== revision.meta.headSha && !options.allowOutdated) {
    throw new Error(
      `the PR has new commits since ${label} was written (${revision.meta.headSha} → ${current.head.sha}). ` +
        "Run prepare and revise, or pass --allow-outdated to post against the reviewed commit",
    );
  }
  if (reviewer.login === current.user.login && payload.event !== "COMMENT") {
    throw new Error("GitHub does not allow approving or requesting changes on your own PR");
  }

  if (
    options.expectedPayload &&
    JSON.stringify(payload) !== JSON.stringify(options.expectedPayload)
  )
    throw new Error("The review changed. Preview it again before posting.");
  if (options.dryRun) return { status: "dry-run", payload };

  const response = await ghJson<{ id: number; html_url: string }>(
    options.gh,
    ["api", "--method", "POST", `${repoPath}/pulls/${pr.number}/reviews`, "--input", "-"],
    JSON.stringify(payload),
  );
  const at = (options.now?.() ?? new Date()).toISOString();
  const synced = { at, url: response.html_url, reviewId: response.id };
  saveDraft(revision, reviewer, { ...draft, synced });

  const warnings: string[] = [];
  if (payload.comments.length > 0) {
    try {
      const pages = await ghJson<PostedComment[][]>(options.gh, [
        "api",
        "--paginate",
        "--slurp",
        `${repoPath}/pulls/${pr.number}/reviews/${response.id}/comments`,
      ]);
      const comments = matchPostedComments(payload, sources, pages.flat());
      if (comments.length < payload.comments.length) {
        warnings.push(
          `matched ${comments.length} of ${payload.comments.length} posted comments to the draft`,
        );
      }
      saveDraft(revision, reviewer, { ...draft, synced: { ...synced, comments } });
    } catch (error) {
      warnings.push(
        `the review was posted, but its comment links were not recorded: ${(error as Error).message}`,
      );
    }
  }
  return { status: "posted", payload, url: response.html_url, warnings };
}
