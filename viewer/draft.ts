import type { Side } from "../shared/diff.ts";
import type { Draft, ReviewEvent } from "../shared/schema.ts";

export type DraftAction =
  | { type: "replace"; draft: Draft }
  | { type: "decideFinding"; id: string; status: "accepted" | "dismissed" | null }
  | { type: "editFinding"; id: string; body: string }
  | { type: "addComment"; id: string; path: string; side: Side; line: number }
  | { type: "editComment"; id: string; body: string }
  | { type: "removeComment"; id: string }
  | { type: "toggleViewed"; sectionId: string }
  | { type: "setBody"; body: string }
  | { type: "setEvent"; event: ReviewEvent }
  | { type: "markReady"; at: string }
  | { type: "reopen" };

export function draftReducer(draft: Draft, action: DraftAction): Draft {
  switch (action.type) {
    case "replace":
      return action.draft;
    case "decideFinding": {
      const findings = { ...draft.findings };
      if (action.status === null) {
        delete findings[action.id];
      } else {
        findings[action.id] = { ...findings[action.id], status: action.status };
      }
      return { ...draft, findings };
    }
    case "editFinding":
      return {
        ...draft,
        findings: { ...draft.findings, [action.id]: { status: "accepted", body: action.body } },
      };
    case "addComment":
      return {
        ...draft,
        comments: [
          ...draft.comments,
          { id: action.id, path: action.path, side: action.side, line: action.line, body: "" },
        ],
      };
    case "editComment":
      return {
        ...draft,
        comments: draft.comments.map((c) => (c.id === action.id ? { ...c, body: action.body } : c)),
      };
    case "removeComment":
      return { ...draft, comments: draft.comments.filter((c) => c.id !== action.id) };
    case "toggleViewed": {
      const viewed = draft.viewedSections.includes(action.sectionId)
        ? draft.viewedSections.filter((id) => id !== action.sectionId)
        : [...draft.viewedSections, action.sectionId];
      return { ...draft, viewedSections: viewed };
    }
    case "setBody":
      return { ...draft, body: action.body };
    case "setEvent":
      return { ...draft, event: action.event };
    case "markReady":
      return { ...draft, readyAt: action.at };
    case "reopen":
      return { ...draft, readyAt: null };
  }
}

export function readinessProblems(draft: Draft): string[] {
  const problems: string[] = [];
  if (!draft.event) problems.push("Choose comment, approve, or request changes.");
  if (draft.event && draft.event !== "APPROVE" && !draft.body.trim()) {
    problems.push("GitHub requires a summary unless you approve.");
  }
  return problems;
}
