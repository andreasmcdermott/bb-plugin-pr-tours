import { computeChanges } from "../shared/changes.ts";
import { ownsTour } from "../shared/review.ts";
import type { Changes } from "../shared/schema.ts";
import { currentUser, type Gh } from "./gh.ts";
import {
  latestRevision,
  loadPrepared,
  loadSnapshot,
  resolveTour,
  writeRevision,
  type RevisionEntry,
  type TourEntry,
} from "./review-dir.ts";

export type ReviseResult = {
  entry: TourEntry;
  previous: RevisionEntry;
  revision: RevisionEntry;
  changes: Changes;
  openFindings: string[];
};

export async function revise(options: {
  gh: Gh;
  dir: string;
  tour?: string;
  model?: string;
  agent?: string;
  now?: () => Date;
}): Promise<ReviseResult> {
  const prepared = loadPrepared(options.dir);
  const entry = resolveTour(options.dir, options.tour);
  const previous = latestRevision(entry);
  const label = `tour ${entry.id} r${previous.revision}`;

  const viewer = await currentUser(options.gh);
  if (!ownsTour(entry.meta.author, viewer)) {
    throw new Error(
      `only ${entry.meta.author.login}, who created tour ${entry.id}, can revise it; ` +
        "start your own tour with `pr-tour new-tour` instead",
    );
  }
  if (previous.load.status !== "ok") {
    throw new Error(`${label} has no valid tour.json yet; finish it before starting a revision`);
  }
  if (previous.meta.headSha === prepared.pr.headSha) {
    throw new Error(
      `${label} already covers ${prepared.pr.headSha}; run \`pr-tour prepare\` once the PR has new commits`,
    );
  }

  const number = previous.revision + 1;
  const changes = computeChanges(
    {
      revision: previous.revision,
      headSha: previous.meta.headSha,
      files: loadSnapshot(previous).files,
    },
    { revision: number, headSha: prepared.pr.headSha, files: prepared.files },
  );
  const revision = writeRevision(
    entry.dir,
    {
      revision: number,
      headSha: prepared.pr.headSha,
      model: options.model ?? previous.meta.model,
      agent: options.agent ?? previous.meta.agent,
      createdAt: (options.now?.() ?? new Date()).toISOString(),
    },
    prepared,
    changes,
  );
  const openFindings = previous.load.tour.sections.flatMap((section) =>
    section.findings.map((finding) => finding.id),
  );
  return {
    entry: { ...entry, revisions: [...entry.revisions, revision] },
    previous,
    revision,
    changes,
    openFindings,
  };
}
