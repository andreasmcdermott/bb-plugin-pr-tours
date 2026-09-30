import { useState } from "react";
import type { RevisionRef } from "../api.ts";
import type { ReviewPreview } from "../../shared/plugin-contract.ts";
import { useTourApi } from "../runtime.tsx";
import { Markdown } from "./Markdown.tsx";

export function PostReview({
  revisionRef,
  onPosted,
}: {
  revisionRef: RevisionRef;
  onPosted: (warnings?: string[]) => void;
}) {
  const api = useTourApi();
  const [preview, setPreview] = useState<ReviewPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [posted, setPosted] = useState<{ url: string; warnings: string[] } | null>(null);
  if (!api.previewReview || !api.postReview) return null;
  async function load() {
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      await api.flush?.();
      setPreview(await api.previewReview!(revisionRef));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function post() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      await api.flush?.();
      const result = await api.postReview!(revisionRef, preview.token);
      setPosted(result);
      setPreview(null);
      onPosted(result.warnings);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  if (posted)
    return (
      <div role="status">
        <p>
          Review posted.{" "}
          <a href={posted.url} target="_blank" rel="noreferrer">
            View on GitHub
          </a>
        </p>
        {posted.warnings.map((w) => (
          <p key={w}>{w}</p>
        ))}
        <button className="button" onClick={() => onPosted(posted.warnings)}>
          Reload posted review
        </button>
      </div>
    );
  return (
    <div className="post-review">
      {error && <p role="alert">{error}</p>}
      {!preview && (
        <button className="button button--primary" disabled={busy} onClick={() => void load()}>
          {busy ? "Preparing preview…" : "Preview GitHub review"}
        </button>
      )}
      {preview && (
        <div className="panel" aria-label="GitHub review preview">
          <h3>Post as {preview.viewer.login}</h3>
          <p>
            {preview.payload.event.replaceAll("_", " ")} · Commit{" "}
            <code>{preview.payload.commit_id.slice(0, 7)}</code> · {preview.payload.comments.length}{" "}
            inline comments
          </p>
          <Markdown>{preview.payload.body || "No review summary."}</Markdown>
          {preview.payload.comments.map((comment, index) => (
            <div className="panel" key={index}>
              <strong>
                {comment.path}:{comment.start_line ? `${comment.start_line}–` : ""}
                {comment.line} ({comment.side})
              </strong>
              <Markdown>{comment.body}</Markdown>
            </div>
          ))}
          <button className="button button--primary" disabled={busy} onClick={() => void post()}>
            {busy ? "Posting…" : "Post to GitHub"}
          </button>{" "}
          <button className="button" disabled={busy} onClick={() => setPreview(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
