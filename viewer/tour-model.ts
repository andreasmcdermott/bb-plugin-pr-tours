import type { DiffFile, Hunk, Side } from "../shared/diff.ts";
import type { Changes, Finding, FollowUp, RangeNote, Tour, Why } from "../shared/schema.ts";
import { resolveAnchor, resolveRange } from "../shared/validate.ts";

export type PlacedRange = { start: number; end: number; note: string };

export type Entry = {
  ref: string;
  note: string;
  why: Why | null;
  file: DiffFile;
  hunk: Hunk | null;
  ranges: PlacedRange[];
  unplacedRanges: RangeNote[];
};

export type RenderedSection = {
  id: string;
  title: string;
  narrative: string;
  entries: Entry[];
  inlineFindings: Map<string, Finding[]>;
  otherFindings: Finding[];
  synthetic: boolean;
};

export const lineKey = (hunkId: string, side: Side, line: number) => `${hunkId}|${side}:${line}`;

export const UNANNOTATED_SECTION_ID = "__unannotated";

function unitIndex(files: DiffFile[]): Map<string, { file: DiffFile; hunk: Hunk | null }> {
  const index = new Map<string, { file: DiffFile; hunk: Hunk | null }>();
  for (const file of files) {
    if (file.hunks.length === 0) index.set(file.path, { file, hunk: null });
    for (const hunk of file.hunks) index.set(hunk.id, { file, hunk });
  }
  return index;
}

export function buildSections(
  tour: Tour | null,
  files: DiffFile[],
  uncovered: string[],
): RenderedSection[] {
  const units = unitIndex(files);
  const entriesFor = (refs: { ref: string; note: string; why?: Why; ranges?: RangeNote[] }[]) =>
    refs.flatMap(({ ref, note, why, ranges = [] }): Entry[] => {
      const unit = units.get(ref);
      if (!unit) return [];
      const placed: PlacedRange[] = [];
      const unplacedRanges: RangeNote[] = [];
      for (const range of ranges) {
        const resolved = unit.hunk ? resolveRange(range, unit.hunk) : null;
        if (resolved?.kind === "placed") {
          placed.push({ start: resolved.start, end: resolved.end, note: range.note });
        } else {
          unplacedRanges.push(range);
        }
      }
      placed.sort((a, b) => a.start - b.start);
      return [{ ref, note, why: why ?? null, ...unit, ranges: placed, unplacedRanges }];
    });

  const sections: RenderedSection[] = (tour?.sections ?? []).map((section) => {
    const entries = entriesFor(section.hunks);
    const hunkIds = new Set(entries.map((e) => e.ref));
    const inlineFindings = new Map<string, Finding[]>();
    const otherFindings: Finding[] = [];

    for (const finding of section.findings) {
      const resolved = resolveAnchor(finding.anchor, files);
      const { anchor } = finding;
      if (resolved.kind === "line" && hunkIds.has(resolved.hunkId) && anchor.line !== undefined) {
        const key = lineKey(resolved.hunkId, anchor.side, anchor.line);
        inlineFindings.set(key, [...(inlineFindings.get(key) ?? []), finding]);
      } else {
        otherFindings.push(finding);
      }
    }
    return { ...section, entries, inlineFindings, otherFindings, synthetic: false };
  });

  const leftover = tour ? uncovered : [...units.keys()];
  if (leftover.length > 0) {
    sections.push({
      id: UNANNOTATED_SECTION_ID,
      title: tour ? "Changes the tour does not explain" : "Unannotated diff",
      narrative: tour
        ? "The agent's tour skipped these hunks. Review them without annotations."
        : "There is no valid tour.json yet, so this is the raw diff.",
      entries: entriesFor(leftover.map((ref) => ({ ref, note: "" }))),
      inlineFindings: new Map(),
      otherFindings: [],
      synthetic: true,
    });
  }
  return sections;
}

export function requirementLinks(tour: Tour): Map<string, string[]> {
  const links = new Map<string, string[]>();
  for (const { ref, why } of tour.sections.flatMap((section) => section.hunks)) {
    if (why.kind !== "requirement") continue;
    for (const id of why.requirements) links.set(id, [...(links.get(id) ?? []), ref]);
  }
  return links;
}

export function unexplainedHunks(tour: Tour): { ref: string; note: string; section: string }[] {
  return tour.sections.flatMap((section) =>
    section.hunks
      .filter(({ why }) => why.kind === "unexplained")
      .map(({ ref, note }) => ({ ref, note, section: section.title })),
  );
}

export type RevisionView = {
  previous: number;
  changed: Set<string>;
  unchanged: Set<string>;
};

type HunkSummary = { ref: string; note: string; section: string };

export type SinceRevision = {
  changed: HunkSummary[];
  dropped: HunkSummary[];
  followUp: (FollowUp & { previous: Finding | undefined })[];
  stillOpen: Finding[];
  added: Finding[];
};

function hunkSummaries(tour: Tour, refs: string[]): HunkSummary[] {
  const byRef = new Map(
    tour.sections.flatMap((section) =>
      section.hunks.map(({ ref, note }) => [ref, { ref, note, section: section.title }] as const),
    ),
  );
  return refs.map((ref) => byRef.get(ref) ?? { ref, note: "", section: "" });
}

export function sinceRevision(tour: Tour, previous: Tour, changes: Changes): SinceRevision {
  const previousFindings = new Map(
    previous.sections.flatMap((s) => s.findings).map((finding) => [finding.id, finding]),
  );
  const findings = tour.sections.flatMap((section) => section.findings);
  return {
    changed: hunkSummaries(tour, changes.changed),
    dropped: hunkSummaries(
      previous,
      changes.dropped.filter((ref) => !changes.changed.includes(ref)),
    ),
    followUp: tour.followUp.map((entry) => ({
      ...entry,
      previous: previousFindings.get(entry.finding),
    })),
    stillOpen: findings.filter(({ id }) => previousFindings.has(id)),
    added: findings.filter(({ id }) => !previousFindings.has(id)),
  };
}
