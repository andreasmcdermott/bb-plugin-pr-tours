import type { RevisionMeta } from "../../shared/schema.ts";
import type { TourSummary } from "../api.ts";

function label(tour: TourSummary, headSha: string): string {
  const { author, model, agent, createdAt } = tour.meta;
  const by = agent ? `${model} via ${agent}` : model;
  const when = new Date(createdAt).toLocaleDateString();
  const state =
    tour.status !== "ok"
      ? ` · ${tour.status === "missing" ? "not written yet" : "invalid"}`
      : tour.headSha === headSha
        ? ""
        : ` · outdated (${tour.headSha.slice(0, 7)})`;
  return `${by} · ${author.login} · ${when} · r${tour.revision} · ${tour.findings} findings${state}`;
}

export function TourPicker({
  tours,
  tourId,
  liveHeadSha,
  revisions,
  revision,
  onNavigate,
}: {
  tours: TourSummary[];
  tourId: string;
  liveHeadSha: string;
  revisions: RevisionMeta[];
  revision: number;
  onNavigate: (ref: { tourId: string; revision: number }) => void;
}) {
  const latest = revisions.at(-1)?.revision;
  return (
    <div className="tour-picker">
      <label>
        Tour
        <select
          value={tourId}
          onChange={(e) =>
            onNavigate({
              tourId: e.target.value,
              revision: tours.find((t) => t.id === e.target.value)!.revision,
            })
          }
        >
          {tours.map((tour) => (
            <option key={tour.id} value={tour.id}>
              {label(tour, liveHeadSha)}
            </option>
          ))}
        </select>
      </label>
      {revisions.length > 1 && (
        <label>
          Revision
          <select
            value={revision}
            onChange={(e) => {
              const next = Number(e.target.value);
              onNavigate({ tourId, revision: next });
            }}
          >
            {[...revisions].reverse().map((r) => (
              <option key={r.revision} value={r.revision}>
                r{r.revision} · {r.headSha.slice(0, 7)} · {new Date(r.createdAt).toLocaleString()}
                {r.revision === latest ? " · latest" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
