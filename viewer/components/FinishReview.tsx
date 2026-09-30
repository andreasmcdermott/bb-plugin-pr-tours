import { PostReview } from "./PostReview.tsx";
import { Markdown } from "./Markdown.tsx";
import { useTourApi } from "../runtime.tsx";
import type { RevisionRef } from "../api.ts";
import { REVIEW_EVENTS, type Draft, type ReviewEvent, type Tour } from "../../shared/schema.ts";
import type { Dispatch } from "../App.tsx";
import { readinessProblems } from "../draft.ts";

const EVENT_LABEL: Record<ReviewEvent, string> = {
  COMMENT: "Comment",
  APPROVE: "Approve",
  REQUEST_CHANGES: "Request changes",
};

export function FinishReview({
  tour,
  draft,
  dispatch,
  isAuthor,
  isLatest,
  posted,
  syncCommand,
  revisionRef,
  onPosted,
}: {
  tour: Tour | null;
  draft: Draft;
  dispatch: Dispatch;
  isAuthor: boolean;
  isLatest: boolean;
  posted: ReadonlySet<string>;
  syncCommand: string;
  revisionRef: RevisionRef;
  onPosted: (warnings?: string[]) => void;
}) {
  const api = useTourApi();
  const tourFindings = tour?.sections.flatMap((s) => s.findings) ?? [];
  const postedBefore = tourFindings.filter((f) => posted.has(f.id)).length;
  const findings = isAuthor ? tourFindings.filter((f) => !posted.has(f.id)) : [];
  const accepted = findings.filter((f) => draft.findings[f.id]?.status === "accepted").length;
  const undecided = findings.filter((f) => !draft.findings[f.id]).length;
  const comments = draft.comments.filter((c) => c.body.trim()).length;
  const problems = readinessProblems(draft, accepted);
  const locked = !isLatest || draft.readyAt !== null || draft.synced !== null;

  return (
    <section className="panel finish" id="finish">
      <h2>Finish review</h2>
      <p>
        {isAuthor && `${accepted} accepted ${accepted === 1 ? "finding" : "findings"} and `}
        {comments} of your {comments === 1 ? "comment" : "comments"} will be posted.
        {undecided > 0 && (
          <strong className="finish__warning">
            {" "}
            {undecided} {undecided === 1 ? "finding is" : "findings are"} still undecided.
          </strong>
        )}
      </p>
      {draft.synced ? (
        draft.body.trim() && <Markdown>{draft.body}</Markdown>
      ) : (
        <textarea
          className="comment__input"
          rows={5}
          placeholder="Review summary for the author"
          value={draft.body}
          readOnly={locked}
          onChange={(e) => dispatch({ type: "setBody", body: e.target.value })}
        />
      )}
      {!draft.synced && (
        <p className="finish__muted">A summary is optional when posting comments or approving.</p>
      )}
      <fieldset className="finish__events" disabled={locked}>
        {REVIEW_EVENTS.map((event) => (
          <label key={event}>
            <input
              type="radio"
              name="event"
              checked={draft.event === event}
              onChange={() => dispatch({ type: "setEvent", event })}
            />
            {EVENT_LABEL[event]}
          </label>
        ))}
      </fieldset>
      {postedBefore > 0 && (
        <p className="finish__muted">
          {postedBefore} {postedBefore === 1 ? "finding was" : "findings were"} posted in an earlier
          revision and won’t be posted again.
        </p>
      )}
      {draft.synced ? (
        <p>
          Posted to GitHub on {new Date(draft.synced.at).toLocaleString()}:{" "}
          <a href={draft.synced.url} target="_blank" rel="noreferrer">
            View on GitHub
          </a>
        </p>
      ) : !isLatest ? (
        <p>This revision was not posted to GitHub.</p>
      ) : draft.readyAt ? (
        <div className="finish__ready">
          {api.previewReview ? (
            <PostReview revisionRef={revisionRef} onPosted={onPosted} />
          ) : (
            <>
              <p>Ready to sync. Ask your agent to post it, or run:</p>
              <pre>{syncCommand}</pre>
            </>
          )}
          <button type="button" className="button" onClick={() => dispatch({ type: "reopen" })}>
            Keep editing
          </button>
        </div>
      ) : (
        <>
          {problems.map((problem) => (
            <p key={problem} className="finish__warning">
              {problem}
            </p>
          ))}
          <button
            type="button"
            className="button button--primary"
            disabled={problems.length > 0}
            onClick={() => dispatch({ type: "markReady", at: new Date().toISOString() })}
          >
            {api.previewReview ? "Mark ready for preview" : "Mark ready to sync"}
          </button>
        </>
      )}
    </section>
  );
}
