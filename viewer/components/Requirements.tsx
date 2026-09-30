import type { Tour } from "../../shared/schema.ts";
import { requirementLinks } from "../tour-model.ts";
import { Markdown } from "./Markdown.tsx";

export function Requirements({ tour }: { tour: Tour }) {
  if (tour.requirements.length === 0) return null;
  const links = requirementLinks(tour);
  return (
    <section className="panel" id="requirements">
      <h2>Requirements</h2>
      <ul className="requirements">
        {tour.requirements.map((requirement) => {
          const refs = links.get(requirement.id) ?? [];
          return (
            <li key={requirement.id} className="requirement" id={`requirement-${requirement.id}`}>
              <span className={`badge badge--${requirement.status}`}>{requirement.status}</span>
              <div className="requirement__body">
                <div className="requirement__text">
                  <strong>{requirement.id}</strong>
                  <Markdown>{requirement.text}</Markdown>
                </div>
                {requirement.notes && <Markdown>{requirement.notes}</Markdown>}
                {refs.length > 0 && (
                  <div className="requirement__refs">
                    {refs.map((ref) => (
                      <a key={ref} href={`#hunk-${ref}`}>
                        <code>{ref}</code>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
