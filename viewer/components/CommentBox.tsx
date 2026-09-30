import type { ReviewerComment } from "../../shared/schema.ts";
import type { Dispatch } from "../App.tsx";

export function CommentBox({
  comment,
  dispatch,
  readOnly,
}: {
  comment: ReviewerComment;
  dispatch: Dispatch;
  readOnly: boolean;
}) {
  return (
    <div className="comment">
      <div className="comment__label">Your comment</div>
      <textarea
        className="comment__input"
        value={comment.body}
        placeholder="Leave a comment for the author…"
        autoFocus={comment.body === ""}
        readOnly={readOnly}
        rows={3}
        onChange={(e) => dispatch({ type: "editComment", id: comment.id, body: e.target.value })}
      />
      {!readOnly && (
        <button
          type="button"
          className="button button--quiet"
          onClick={() => dispatch({ type: "removeComment", id: comment.id })}
        >
          Delete
        </button>
      )}
    </div>
  );
}
