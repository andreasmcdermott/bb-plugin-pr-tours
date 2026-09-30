import type { DiffFile } from "./diff.ts";
import type { Anchor, Draft, Finding, GitHubUser, ReviewEvent, Tour } from "./schema.ts";
import { resolveAnchor } from "./validate.ts";

export type ReviewComment = {
  path: string;
  body: string;
  line: number;
  side: "LEFT" | "RIGHT";
  start_line?: number;
  start_side?: "LEFT" | "RIGHT";
};

export type ReviewPayload = {
  commit_id: string;
  event: ReviewEvent;
  body: string;
  comments: ReviewComment[];
};

const SEVERITY_LABEL: Record<Finding["severity"], string> = {
  blocker: "Blocker",
  major: "Issue",
  minor: "Suggestion",
  nit: "Nit",
  question: "Question",
};

function fence(content: string, info: string): string {
  const longestRun = Math.max(2, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(longestRun + 1);
  return `${ticks}${info}\n${content.replace(/\n$/, "")}\n${ticks}`;
}

export function findingCommentBody(finding: Finding, editedBody?: string): string {
  const parts = [`**${SEVERITY_LABEL[finding.severity]}: ${finding.title}**`];
  const body = (editedBody ?? finding.body).trim();
  if (body) parts.push(body);
  if (finding.suggestion !== undefined) parts.push(fence(finding.suggestion, "suggestion"));
  return parts.join("\n\n");
}

function anchorLabel(anchor: Anchor): string {
  if (anchor.line === undefined) return anchor.path;
  const range = anchor.startLine ? `${anchor.startLine}-${anchor.line}` : `${anchor.line}`;
  return `${anchor.path}:${range}${anchor.side === "LEFT" ? " (old)" : ""}`;
}

export function acceptedFindings(tour: Tour, draft: Draft): { finding: Finding; body?: string }[] {
  return tour.sections.flatMap((section) =>
    section.findings.flatMap((finding) => {
      const state = draft.findings[finding.id];
      return state?.status === "accepted" ? [{ finding, body: state.body }] : [];
    }),
  );
}

export function ownsTour(author: GitHubUser, reviewer: GitHubUser): boolean {
  return author.id === reviewer.id;
}

export type FindingHistory = {
  revision: number;
  status: "accepted" | "dismissed";
  posted: boolean;
  url: string | null;
};

export const findingSource = (id: string) => `finding:${id}`;
export const commentSource = (id: string) => `comment:${id}`;

export function findingHistory(
  revisions: { revision: number; draft: Draft | null }[],
): Record<string, FindingHistory> {
  const history: Record<string, FindingHistory> = {};
  for (const { revision, draft } of revisions) {
    if (!draft) continue;
    for (const [id, state] of Object.entries(draft.findings)) {
      if (history[id]?.posted) continue;
      const posted = state.status === "accepted" && draft.synced !== null;
      const comment = draft.synced?.comments?.find((c) => c.source === findingSource(id));
      history[id] = {
        revision,
        status: state.status,
        posted,
        url: posted ? (comment?.url ?? draft.synced!.url) : null,
      };
    }
  }
  return history;
}

export function postedFindings(history: Record<string, FindingHistory>): Set<string> {
  return new Set(
    Object.entries(history)
      .filter(([, entry]) => entry.posted)
      .map(([id]) => id),
  );
}

export type BuiltReview = { payload: ReviewPayload; sources: string[] };

export function buildReview(
  tour: Tour,
  draft: Draft,
  files: DiffFile[],
  people: { author: GitHubUser; reviewer: GitHubUser },
  posted: ReadonlySet<string> = new Set(),
): BuiltReview {
  if (!draft.event)
    throw new Error("the draft has no review decision (comment, approve, or request changes)");

  const findings = acceptedFindings(tour, draft);
  if (findings.length > 0 && !ownsTour(people.author, people.reviewer)) {
    throw new Error(
      `only ${people.author.login}, who created this tour, can post its findings; ` +
        "add your own line comments instead",
    );
  }
  const repeated = findings.filter(({ finding }) => posted.has(finding.id));
  if (repeated.length > 0) {
    const ids = repeated.map(({ finding }) => `"${finding.id}"`).join(", ");
    throw new Error(`already posted in an earlier revision, so they can't be posted again: ${ids}`);
  }

  const comments: ReviewComment[] = [];
  const sources: string[] = [];
  const bodyNotes: string[] = [];

  for (const { finding, body } of findings) {
    const text = findingCommentBody(finding, body);
    const { anchor } = finding;
    if (resolveAnchor(anchor, files).kind === "line" && anchor.line !== undefined) {
      comments.push({
        path: anchor.path,
        body: text,
        line: anchor.line,
        side: anchor.side,
        ...(anchor.startLine !== undefined && {
          start_line: anchor.startLine,
          start_side: anchor.side,
        }),
      });
      sources.push(findingSource(finding.id));
    } else {
      bodyNotes.push(`#### \`${anchorLabel(anchor)}\`\n\n${text}`);
    }
  }

  for (const comment of draft.comments) {
    const body = comment.body.trim();
    if (!body) continue;
    const anchor: Anchor = { path: comment.path, line: comment.line, side: comment.side };
    if (resolveAnchor(anchor, files).kind === "line") {
      comments.push({ path: comment.path, body, line: comment.line, side: comment.side });
      sources.push(commentSource(comment.id));
    } else {
      bodyNotes.push(`#### \`${anchorLabel(anchor)}\`\n\n${body}`);
    }
  }

  const sections = [draft.body.trim()];
  if (bodyNotes.length > 0)
    sections.push(`### Notes outside the diff\n\n${bodyNotes.join("\n\n")}`);
  const reviewBody = sections.filter(Boolean).join("\n\n");

  if (draft.event === "REQUEST_CHANGES" && !reviewBody) {
    throw new Error(`GitHub requires a review summary when the decision is ${draft.event}`);
  }
  if (draft.event === "COMMENT" && !reviewBody && comments.length === 0) {
    throw new Error("Add a summary, a line comment, or accept a finding.");
  }

  return {
    payload: { commit_id: draft.headSha, event: draft.event, body: reviewBody, comments },
    sources,
  };
}
