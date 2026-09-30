import { TourRootContext } from "../runtime.tsx";
import { useContext, useEffect, useState } from "react";
import type { DiffFile } from "../../shared/diff.ts";
import type { FindingHistory } from "../../shared/review.ts";
import type { Draft } from "../../shared/schema.ts";
import { describeRange } from "../../shared/validate.ts";
import type { Dispatch } from "../App.tsx";
import type { Entry, RenderedSection, RevisionView } from "../tour-model.ts";
import { DiffHunk } from "./DiffHunk.tsx";
import { FindingCard } from "./FindingCard.tsx";
import { Markdown } from "./Markdown.tsx";
import { WhyChip } from "./Why.tsx";

type SectionProps = {
  section: RenderedSection;
  sectionTitles: Map<string, string>;
  draft: Draft;
  dispatch: Dispatch;
  readOnly: boolean;
  findingsReadOnly: boolean;
  viewedReadOnly: boolean;
  history: Record<string, FindingHistory>;
  revisionView: RevisionView | null;
};

function fileLabel(file: DiffFile): string {
  if (file.status === "renamed" && file.oldPath) return `${file.oldPath} → ${file.path}`;
  return file.path;
}

function nonTextSummary(file: DiffFile): string {
  if (file.binary) return "Binary file changed.";
  if (file.status === "renamed") return "Renamed without content changes.";
  return "No text changes (for example, a file mode change).";
}

function EntryView({ entry, ...props }: SectionProps & { entry: Entry }) {
  const { file, hunk } = entry;
  const { revisionView } = props;
  return (
    <div className="entry" id={`hunk-${entry.ref}`}>
      <div className="entry__file">
        <span className={`status status--${file.status}`}>{file.status}</span>
        <code>{fileLabel(file)}</code>
        {entry.why && <WhyChip why={entry.why} sectionTitles={props.sectionTitles} />}
        {revisionView?.changed.has(entry.ref) && (
          <span className="changed-chip">Changed since r{revisionView.previous}</span>
        )}
      </div>
      <Markdown>{entry.note}</Markdown>
      {entry.unplacedRanges.map((range, index) => (
        <div key={index} className="entry__range">
          <span className="entry__range-lines">{describeRange(range)}</span>
          <Markdown>{range.note}</Markdown>
        </div>
      ))}
      {hunk ? (
        <DiffHunk
          file={file}
          hunk={hunk}
          ranges={entry.ranges}
          inlineFindings={props.section.inlineFindings}
          draft={props.draft}
          dispatch={props.dispatch}
          readOnly={props.readOnly}
          findingsReadOnly={props.findingsReadOnly}
          history={props.history}
        />
      ) : (
        <p className="entry__nontext">{nonTextSummary(file)}</p>
      )}
    </div>
  );
}

export function Section(props: SectionProps) {
  const { section, draft, dispatch, revisionView } = props;
  const viewed = draft.viewedSections.includes(section.id);
  const unchanged = revisionView?.unchanged.has(section.id) ?? false;
  const [expanded, setExpanded] = useState(!unchanged);

  const rootRef = useContext(TourRootContext);
  useEffect(() => {
    if (!unchanged) return;
    const findings = [...section.inlineFindings.values()].flat().concat(section.otherFindings);
    const targets = new Set([
      `#section-${section.id}`,
      ...section.entries.map((entry) => `#hunk-${entry.ref}`),
      ...findings.map((finding) => `#finding-${finding.id}`),
    ]);
    const expandForHash = (event?: Event) => {
      const hash =
        event?.type === "tour-jump"
          ? `#${(event as CustomEvent<string>).detail}`
          : decodeURIComponent(window.location.hash);
      if (!targets.has(hash)) return;
      setExpanded(true);
      requestAnimationFrame(() =>
        rootRef?.current?.querySelector(`[id="${CSS.escape(hash.slice(1))}"]`)?.scrollIntoView(),
      );
    };
    expandForHash();
    const root = rootRef?.current;
    root?.addEventListener("tour-jump", expandForHash);
    return () => root?.removeEventListener("tour-jump", expandForHash);
  }, [unchanged, section, rootRef]);
  const classes = [
    "section",
    section.synthetic && "section--synthetic",
    unchanged && "section--unchanged",
  ].filter(Boolean);

  return (
    <section className={classes.join(" ")} id={`section-${section.id}`}>
      <header className="section__header">
        <h2>{section.title}</h2>
        {unchanged && (
          <button
            type="button"
            className="button button--quiet section__toggle"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Collapse" : `Unchanged since r${revisionView!.previous} · Show`}
          </button>
        )}
        <label className="section__viewed">
          <input
            type="checkbox"
            checked={viewed}
            disabled={props.viewedReadOnly}
            onChange={() => dispatch({ type: "toggleViewed", sectionId: section.id })}
          />
          Viewed
        </label>
      </header>
      {expanded && (
        <>
          <Markdown>{section.narrative}</Markdown>
          {section.entries.map((entry) => (
            <EntryView key={entry.ref} entry={entry} {...props} />
          ))}
          {section.otherFindings.length > 0 && (
            <div className="section__findings">
              <h3>Findings outside these hunks</h3>
              {section.otherFindings.map((finding) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  state={draft.findings[finding.id]}
                  history={props.history[finding.id]}
                  dispatch={dispatch}
                  readOnly={props.findingsReadOnly}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
