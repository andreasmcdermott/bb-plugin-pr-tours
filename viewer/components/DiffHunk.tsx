import { Fragment, useMemo } from "react";
import { findHunkForLine, type DiffFile, type DiffLine, type Hunk } from "../../shared/diff.ts";
import type { FindingHistory } from "../../shared/review.ts";
import type { Draft, Finding } from "../../shared/schema.ts";
import type { Dispatch } from "../App.tsx";
import { highlightHunk } from "../highlight.ts";
import { lineKey, type PlacedRange } from "../tour-model.ts";
import { CommentBox } from "./CommentBox.tsx";
import { FindingCard } from "./FindingCard.tsx";
import { Markdown } from "./Markdown.tsx";
import { Tokens } from "./Tokens.tsx";

const MARKER: Record<DiffLine["kind"], string> = { add: "+", del: "-", context: " " };

function keysFor(hunk: Hunk, line: DiffLine): string[] {
  const keys: string[] = [];
  if (line.kind !== "del" && line.newLine !== null)
    keys.push(lineKey(hunk.id, "RIGHT", line.newLine));
  if (line.kind !== "add" && line.oldLine !== null)
    keys.push(lineKey(hunk.id, "LEFT", line.oldLine));
  return keys;
}

export function DiffHunk({
  file,
  hunk,
  ranges,
  inlineFindings,
  draft,
  dispatch,
  readOnly,
  findingsReadOnly,
  history,
}: {
  file: DiffFile;
  hunk: Hunk;
  ranges: PlacedRange[];
  inlineFindings: Map<string, Finding[]>;
  draft: Draft;
  dispatch: Dispatch;
  readOnly: boolean;
  findingsReadOnly: boolean;
  history: Record<string, FindingHistory>;
}) {
  const highlighted = useMemo(() => highlightHunk(file.path, hunk), [file.path, hunk]);
  const comments = draft.comments.filter(
    (c) => c.path === file.path && findHunkForLine(file, c.side, c.line)?.hunk === hunk,
  );

  const addComment = (line: DiffLine) => {
    const left = line.kind === "del";
    dispatch({
      type: "addComment",
      id: crypto.randomUUID(),
      path: file.path,
      side: left ? "LEFT" : "RIGHT",
      line: (left ? line.oldLine : line.newLine)!,
    });
  };

  return (
    <div className="hunk">
      <div className="hunk__header">{hunk.header}</div>
      <table className="hunk__table">
        <tbody>
          {hunk.lines.map((line, index) => {
            const keys = keysFor(hunk, line);
            const findings = keys.flatMap((key) => inlineFindings.get(key) ?? []);
            const lineComments = comments.filter((c) =>
              keys.includes(lineKey(hunk.id, c.side, c.line)),
            );
            const inRange = ranges.some(({ start, end }) => start <= index && index <= end);
            return (
              <Fragment key={index}>
                {ranges
                  .filter(({ start }) => start === index)
                  .map((range, rangeIndex) => (
                    <tr key={`range-${rangeIndex}`} className="range-note">
                      <td colSpan={4}>
                        <Markdown>{range.note}</Markdown>
                      </td>
                    </tr>
                  ))}
                <tr className={`line line--${line.kind}${inRange ? " line--in-range" : ""}`}>
                  <td className="line__number">{line.oldLine ?? ""}</td>
                  <td className="line__number">{line.newLine ?? ""}</td>
                  <td className="line__gutter">
                    {!readOnly && (
                      <button
                        type="button"
                        className="line__add"
                        aria-label="Comment on this line"
                        onClick={() => addComment(line)}
                      >
                        +
                      </button>
                    )}
                  </td>
                  <td className="line__code">
                    <span className="line__marker">{MARKER[line.kind]}</span>
                    <Tokens tokens={highlighted[index] ?? [{ content: line.text }]} />
                    {line.noNewlineAtEnd && (
                      <span className="line__eof">No newline at end of file</span>
                    )}
                  </td>
                </tr>
                {(findings.length > 0 || lineComments.length > 0) && (
                  <tr className="line__annotations">
                    <td colSpan={4}>
                      {findings.map((finding) => (
                        <FindingCard
                          key={finding.id}
                          finding={finding}
                          state={draft.findings[finding.id]}
                          dispatch={dispatch}
                          readOnly={findingsReadOnly}
                          history={history[finding.id]}
                        />
                      ))}
                      {lineComments.map((comment) => (
                        <CommentBox
                          key={comment.id}
                          comment={comment}
                          dispatch={dispatch}
                          readOnly={readOnly}
                        />
                      ))}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
