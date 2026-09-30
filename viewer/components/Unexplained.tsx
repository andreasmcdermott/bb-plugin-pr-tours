import { Markdown } from "./Markdown.tsx";

export function Unexplained({
  hunks,
}: {
  hunks: { ref: string; note: string; section: string }[];
}) {
  if (hunks.length === 0) return null;
  const count = hunks.length === 1 ? "1 change" : `${hunks.length} changes`;
  return (
    <section className="panel panel--unexplained" id="unexplained">
      <h2>{count} the agent couldn’t tie to the story</h2>
      <p>
        Each has a question for the author. Explain them in a comment, or update the story if the
        change belongs there.
      </p>
      <ul className="unexplained">
        {hunks.map((hunk) => (
          <li key={hunk.ref}>
            <a href={`#hunk-${hunk.ref}`}>
              <code>{hunk.ref}</code>
            </a>{" "}
            <span className="unexplained__section">in {hunk.section}</span>
            <Markdown>{hunk.note}</Markdown>
          </li>
        ))}
      </ul>
    </section>
  );
}
