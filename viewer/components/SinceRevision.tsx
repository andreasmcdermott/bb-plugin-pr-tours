import type { FindingHistory } from "../../shared/review.ts";
import type { Finding } from "../../shared/schema.ts";
import type { SinceRevision as Since } from "../tour-model.ts";
import { Markdown } from "./Markdown.tsx";

function HunkLinks({ refs }: { refs: string[] }) {
  return refs.map((ref, index) => (
    <span key={ref}>
      {index > 0 && ", "}
      <a href={`#hunk-${ref}`}>
        <code>{ref}</code>
      </a>
    </span>
  ));
}

function FindingLink({ finding }: { finding: Finding }) {
  return <a href={`#finding-${finding.id}`}>{finding.title}</a>;
}

function PastDecision({ history }: { history: FindingHistory | undefined }) {
  if (!history) return null;
  const label = history.posted ? "posted" : history.status;
  return (
    <span className="since__decision">
      {" "}
      · r{history.revision}{" "}
      {history.url ? (
        <a href={history.url} target="_blank" rel="noreferrer">
          {label}
        </a>
      ) : (
        label
      )}
    </span>
  );
}

export function SinceRevision({
  since,
  previous,
  history,
}: {
  since: Since;
  previous: number;
  history: Record<string, FindingHistory>;
}) {
  const resolved = since.followUp.filter((entry) => entry.status === "resolved");
  const outdated = since.followUp.filter((entry) => entry.status === "outdated");
  return (
    <section className="panel panel--since" id="since">
      <h2>Since r{previous}</h2>
      <p>
        {since.changed.length === 0
          ? "No hunks changed."
          : `${since.changed.length} ${since.changed.length === 1 ? "hunk" : "hunks"} changed or new.`}{" "}
        Sections that did not change are collapsed below.
      </p>
      {since.changed.length > 0 && (
        <ul className="since__list">
          {since.changed.map((hunk) => (
            <li key={hunk.ref}>
              <HunkLinks refs={[hunk.ref]} />{" "}
              <span className="since__muted">in {hunk.section}</span>
              <Markdown>{hunk.note}</Markdown>
            </li>
          ))}
        </ul>
      )}
      {since.dropped.length > 0 && (
        <>
          <h3>No longer in the diff</h3>
          <ul className="since__list">
            {since.dropped.map((hunk) => (
              <li key={hunk.ref}>
                <code>{hunk.ref}</code>{" "}
                <span className="since__muted">
                  was in {hunk.section || "an unannotated section"} in r{previous}
                </span>
                <Markdown>{hunk.note}</Markdown>
              </li>
            ))}
          </ul>
        </>
      )}
      {resolved.length > 0 && (
        <>
          <h3>Resolved findings</h3>
          <ul className="since__list">
            {resolved.map((entry) => (
              <li key={entry.finding} className="since__resolved">
                <strong>{entry.previous?.title ?? entry.finding}</strong>
                <PastDecision history={history[entry.finding]} /> · fixed in{" "}
                <HunkLinks refs={entry.refs} />
                <Markdown>{entry.note}</Markdown>
              </li>
            ))}
          </ul>
        </>
      )}
      {outdated.length > 0 && (
        <>
          <h3>Findings that no longer apply</h3>
          <ul className="since__list">
            {outdated.map((entry) => (
              <li key={entry.finding}>
                <strong>{entry.previous?.title ?? entry.finding}</strong>
                <PastDecision history={history[entry.finding]} />
                <Markdown>{entry.note}</Markdown>
              </li>
            ))}
          </ul>
        </>
      )}
      {since.stillOpen.length > 0 && (
        <>
          <h3>Still open</h3>
          <ul className="since__list">
            {since.stillOpen.map((finding) => (
              <li key={finding.id}>
                <FindingLink finding={finding} />
                <PastDecision history={history[finding.id]} />
              </li>
            ))}
          </ul>
        </>
      )}
      {since.added.length > 0 && (
        <>
          <h3>New findings</h3>
          <ul className="since__list">
            {since.added.map((finding) => (
              <li key={finding.id}>
                <FindingLink finding={finding} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
