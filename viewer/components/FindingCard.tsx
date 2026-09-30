import { useMemo, useState } from "react";
import type { FindingHistory } from "../../shared/review.ts";
import type { Draft, Finding } from "../../shared/schema.ts";
import type { Dispatch } from "../App.tsx";
import { highlightLines } from "../highlight.ts";
import { Markdown } from "./Markdown.tsx";
import { Tokens } from "./Tokens.tsx";

function Suggestion({ path, code }: { path: string; code: string }) {
  const lines = useMemo(
    () => highlightLines(path, code.replace(/\n$/, "").split("\n")),
    [path, code],
  );
  return (
    <pre className="suggestion__code">
      {lines.map((tokens, index) => (
        <div key={index}>
          <Tokens tokens={tokens} />
        </div>
      ))}
    </pre>
  );
}

function location(finding: Finding): string {
  const { path, line, startLine, side } = finding.anchor;
  if (line === undefined) return path;
  return `${path}:${startLine ? `${startLine}-` : ""}${line}${side === "LEFT" ? " (old)" : ""}`;
}

export function FindingCard({
  finding,
  state,
  history,
  dispatch,
  readOnly,
}: {
  finding: Finding;
  state: Draft["findings"][string] | undefined;
  history: FindingHistory | undefined;
  dispatch: Dispatch;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const posted = history?.posted ?? false;
  const status = posted ? "posted" : (state?.status ?? "pending");
  const body = state?.body ?? finding.body;
  const decide = (next: "accepted" | "dismissed" | null) =>
    dispatch({ type: "decideFinding", id: finding.id, status: next });

  return (
    <article
      className={`finding finding--${finding.severity} finding--${status}`}
      id={`finding-${finding.id}`}
    >
      <header className="finding__header">
        <span className={`badge badge--${finding.severity}`}>{finding.severity}</span>
        <strong className="finding__title">{finding.title}</strong>
        <span className="finding__location">{location(finding)}</span>
        {status !== "pending" && <span className="finding__status">{status}</span>}
      </header>
      {history && (
        <p className="finding__history">
          {posted ? `Posted in r${history.revision}` : `r${history.revision}: ${history.status}`}
          {history.url && (
            <>
              {" · "}
              <a href={history.url} target="_blank" rel="noreferrer">
                view on GitHub
              </a>
            </>
          )}
          {posted && " · reply there; it can't be posted again"}
        </p>
      )}
      {editing ? (
        <textarea
          className="comment__input"
          value={body}
          rows={5}
          autoFocus
          onChange={(e) => dispatch({ type: "editFinding", id: finding.id, body: e.target.value })}
        />
      ) : (
        <Markdown>{body}</Markdown>
      )}
      {finding.suggestion !== undefined && (
        <div className="suggestion">
          <div className="suggestion__label">Suggested change</div>
          <Suggestion path={finding.anchor.path} code={finding.suggestion} />
        </div>
      )}
      {!readOnly && !posted && (
        <div className="finding__actions">
          {status !== "accepted" && (
            <button
              type="button"
              className="button button--primary"
              onClick={() => decide("accepted")}
            >
              Accept
            </button>
          )}
          <button type="button" className="button" onClick={() => setEditing(!editing)}>
            {editing ? "Done editing" : "Edit and accept"}
          </button>
          {status !== "dismissed" && (
            <button type="button" className="button" onClick={() => decide("dismissed")}>
              Dismiss
            </button>
          )}
          {status !== "pending" && (
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                setEditing(false);
                decide(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </article>
  );
}
