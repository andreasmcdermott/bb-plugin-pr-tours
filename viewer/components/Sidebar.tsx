import { useEffect, useRef } from "react";
import type { Draft } from "../../shared/schema.ts";
import { useReadingPosition } from "../reading-position.ts";
import type { RenderedSection, RevisionView } from "../tour-model.ts";

export function Sidebar({
  sections,
  draft,
  hasRequirements,
  unexplained,
  revisionView,
  finish,
}: {
  sections: RenderedSection[];
  draft: Draft;
  hasRequirements: boolean;
  unexplained: number;
  revisionView: RevisionView | null;
  finish: boolean;
}) {
  const viewed = sections.filter((s) => draft.viewedSections.includes(s.id)).length;
  const targets = [
    "summary",
    revisionView && "since",
    unexplained > 0 && "unexplained",
    hasRequirements && "requirements",
    ...sections.map((section) => `section-${section.id}`),
    finish && "finish",
  ].filter((id): id is string => typeof id === "string");
  const [current, jump] = useReadingPosition(targets);
  const nav = useRef<HTMLElement>(null);

  useEffect(() => {
    const list = nav.current;
    const item = list?.querySelector<HTMLElement>("[aria-current]")?.parentElement;
    if (!list || !item) return;
    const above = item.offsetTop < list.scrollTop;
    const below = item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight;
    if (above || below) list.scrollTop = item.offsetTop - list.clientHeight / 2;
  }, [current]);

  const link = (id: string, label: string) => (
    <a
      href={`#${id}`}
      aria-current={current === id ? "location" : undefined}
      onClick={() => jump(id)}
    >
      {label}
    </a>
  );

  return (
    <nav className="sidebar" aria-label="Tour" ref={nav}>
      <div className="sidebar__progress">
        {viewed} of {sections.length} sections viewed
      </div>
      <ol className="sidebar__list">
        <li>{link("summary", "Summary")}</li>
        {revisionView && (
          <li>
            {link("since", `Since r${revisionView.previous}`)}
            {revisionView.changed.size > 0 && (
              <span className="sidebar__count">{revisionView.changed.size}</span>
            )}
          </li>
        )}
        {unexplained > 0 && (
          <li className="sidebar__unexplained">
            {link("unexplained", "Unexplained changes")}
            <span className="sidebar__count">{unexplained}</span>
          </li>
        )}
        {hasRequirements && <li>{link("requirements", "Requirements")}</li>}
        {sections.map((section) => {
          const findings =
            section.otherFindings.length + [...section.inlineFindings.values()].flat().length;
          const classes = [
            draft.viewedSections.includes(section.id) && "is-viewed",
            revisionView?.unchanged.has(section.id) && "is-unchanged",
          ].filter(Boolean);
          return (
            <li key={section.id} className={classes.join(" ")}>
              {link(`section-${section.id}`, section.title)}
              {findings > 0 && <span className="sidebar__count">{findings}</span>}
            </li>
          );
        })}
        {finish && <li>{link("finish", "Finish review")}</li>}
      </ol>
    </nav>
  );
}
