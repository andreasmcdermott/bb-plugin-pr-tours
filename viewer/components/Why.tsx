import type { Why } from "../../shared/schema.ts";

const shortRef = (ref: string) => ref.slice(ref.lastIndexOf("/") + 1);

function Links({ items }: { items: { href: string; label: string }[] }) {
  return items.map((item, index) => (
    <span key={item.href}>
      {index > 0 && ", "}
      <a href={item.href}>{item.label}</a>
    </span>
  ));
}

export function WhyChip({ why, sectionTitles }: { why: Why; sectionTitles: Map<string, string> }) {
  switch (why.kind) {
    case "requirement":
      return (
        <span className="why why--requirement">
          Implements{" "}
          <Links
            items={why.requirements.map((id) => ({ href: `#requirement-${id}`, label: id }))}
          />
        </span>
      );
    case "supporting":
      return (
        <span className="why why--supporting">
          Supports{" "}
          <Links
            items={why.supports.map((target) => {
              const title = sectionTitles.get(target);
              return title
                ? { href: `#section-${target}`, label: title }
                : { href: `#hunk-${target}`, label: shortRef(target) };
            })}
          />
        </span>
      );
    case "mechanical":
      return <span className="why why--mechanical">Mechanical</span>;
    case "unexplained":
      return <span className="why why--unexplained">Not explained by the story</span>;
  }
}
