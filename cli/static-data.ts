import path from "node:path";
import { emptyDraft } from "../shared/schema.ts";
import {
  revisionKey,
  STATIC_DATA_ID,
  type ReviewResponse,
  type StaticData,
} from "../viewer/api.ts";
import { latestRevision, listTours, resolveTour, type TourEntry } from "./review-dir.ts";
import { reviewResponse, toursResponse } from "./service.ts";

type ExportOptions = { tour?: string };

// Readers get empty drafts so none of the author's unposted work is shared.
export function staticData(dir: string, options: ExportOptions = {}): StaticData {
  const { tour: tourId } = options;
  const entries = tourId ? [resolveTour(dir, tourId)] : listTours(dir);
  const [first] = entries;
  if (!first) throw new Error("the PR has no tours to export");

  const ids = new Set(entries.map((entry) => entry.id));
  const tours = toursResponse(dir, first.meta.author);
  const data: StaticData = {
    mode: "read",
    tours: { ...tours, tours: tours.tours.filter((tour) => ids.has(tour.id)) },
    reviews: {},
    drafts: {},
  };
  for (const entry of entries) addTour(data, dir, entry);
  return data;
}

function addTour(data: StaticData, dir: string, entry: TourEntry) {
  const latest = latestRevision(entry);
  const label = `tour ${entry.id} r${latest.revision}`;
  if (latest.load.status !== "ok")
    throw new Error(
      `${label} has no valid tour.json to export; pass --tour to export another tour`,
    );

  const name = path.basename(dir);
  const command = (verb: string) => `bun run pr-tour ${verb} ${name} --tour ${entry.id}`;
  for (const revision of entry.revisions) {
    const review = reviewResponse(dir, entry, revision, entry.meta.author);
    if (revision === latest && (review.validation?.errors.length ?? 0) > 0) {
      throw new Error(`${label} has validation errors; run \`pr-tour validate\``);
    }
    const key = revisionKey({ tourId: entry.id, revision: revision.revision });
    data.reviews[key] = {
      ...review,
      dir: name,
      syncCommand: command("sync"),
      reviseCommand: command("revise"),
      history: postedOnly(review.history),
    };
    data.drafts[key] = emptyDraft(revision.meta.headSha);
  }
}

function postedOnly(history: ReviewResponse["history"]) {
  return Object.fromEntries(Object.entries(history).filter(([, entry]) => entry.posted));
}

export function embedData(html: string, data: StaticData): string {
  const json = JSON.stringify(data).replaceAll("<", "\\u003c");
  const robots = `<meta name="robots" content="noindex, nofollow">`;
  const script = `<script id="${STATIC_DATA_ID}" type="application/json">${json}</script>`;
  const at = html.indexOf("</head>");
  if (at === -1) throw new Error("the viewer build has no </head> to embed the tour into");
  return html.slice(0, at) + robots + script + html.slice(at);
}
