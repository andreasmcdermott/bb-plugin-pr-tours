import { coverageUnits, findHunkForLine, lineIndex, type DiffFile, type Hunk } from "./diff.ts";
import type { Anchor, Changes, PrMeta, RangeNote, Tour } from "./schema.ts";

export type Validation = {
  errors: string[];
  warnings: string[];
  uncovered: string[];
};

export type AnchorResolution =
  | { kind: "line"; hunkId: string }
  | { kind: "unanchored"; reason: string }
  | { kind: "invalid"; reason: string };

export function resolveAnchor(anchor: Anchor, files: DiffFile[]): AnchorResolution {
  const file = files.find((f) => f.path === anchor.path);
  if (!file) return { kind: "unanchored", reason: `${anchor.path} is not part of the diff` };
  if (anchor.line === undefined) {
    if (anchor.startLine !== undefined)
      return { kind: "invalid", reason: "startLine requires line" };
    return { kind: "unanchored", reason: "no line given" };
  }

  const end = findHunkForLine(file, anchor.side, anchor.line);
  if (!end) {
    if (anchor.startLine !== undefined) {
      return { kind: "invalid", reason: `line ${anchor.line} (${anchor.side}) is not in the diff` };
    }
    return {
      kind: "unanchored",
      reason: `line ${anchor.line} (${anchor.side}) is outside the diff`,
    };
  }

  if (anchor.startLine !== undefined) {
    if (anchor.startLine >= anchor.line) {
      return { kind: "invalid", reason: "startLine must be less than line" };
    }
    const start = findHunkForLine(file, anchor.side, anchor.startLine);
    if (!start || start.hunk !== end.hunk) {
      return { kind: "invalid", reason: "startLine and line must be in the same hunk" };
    }
  }
  return { kind: "line", hunkId: end.hunk.id };
}

export type RangeResolution =
  | { kind: "placed"; start: number; end: number }
  | { kind: "outside" }
  | { kind: "invalid"; reason: string };

// start and end index the hunk's lines, so a range can span both sides' lines.
export function resolveRange(range: RangeNote, hunk: Hunk): RangeResolution {
  if (range.startLine !== undefined && range.startLine >= range.line) {
    return { kind: "invalid", reason: "startLine must be less than line" };
  }
  const end = lineIndex(hunk, range.side, range.line);
  const start = range.startLine === undefined ? end : lineIndex(hunk, range.side, range.startLine);
  if (start === -1 || end === -1) return { kind: "outside" };
  return { kind: "placed", start, end };
}

export function describeRange(range: RangeNote): string {
  const lines =
    range.startLine === undefined ? `line ${range.line}` : `lines ${range.startLine}–${range.line}`;
  return `${lines} (${range.side})`;
}

function rangeErrors(ref: string, ranges: RangeNote[], hunk: Hunk | undefined): string[] {
  if (ranges.length === 0) return [];
  const label = `hunk "${ref}"`;
  if (!hunk) return [`${label} has no lines, so it cannot have range notes`];

  const errors: string[] = [];
  const placed: { range: RangeNote; start: number; end: number }[] = [];
  for (const range of ranges) {
    const resolved = resolveRange(range, hunk);
    const on = `${label} has a range note on ${describeRange(range)}`;
    if (resolved.kind === "placed") placed.push({ range, ...resolved });
    else if (resolved.kind === "invalid") errors.push(`${on}: ${resolved.reason}`);
    else if (range.startLine === undefined) errors.push(`${on}, which is outside the hunk`);
    else errors.push(`${on}, which reach outside the hunk`);
  }

  placed.sort((a, b) => a.start - b.start);
  let widest: (typeof placed)[number] | undefined;
  for (const next of placed) {
    if (widest && next.start <= widest.end) {
      errors.push(
        `${label} has range notes on ${describeRange(widest.range)} and ${describeRange(next.range)} that overlap`,
      );
    }
    if (!widest || next.end > widest.end) widest = next;
  }
  return errors;
}

export type PreviousRevision = { tour: Tour; changes: Changes };

export function validateTour(
  tour: Tour,
  pr: PrMeta,
  files: DiffFile[],
  previous: PreviousRevision | null = null,
): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const units = coverageUnits(files);
  const unitSet = new Set(units);
  const hunksById = new Map(files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk])));
  const coveredBy = new Map<string, string>();
  const sectionIds = new Set<string>();
  const findingIds = new Set<string>();

  if (tour.headSha !== pr.headSha) {
    errors.push(
      `tour.headSha ${tour.headSha} does not match the prepared diff (${pr.headSha}); re-read diff.json and update the tour`,
    );
  }

  const requirementIds = new Set<string>();
  for (const requirement of tour.requirements) {
    if (requirementIds.has(requirement.id)) {
      errors.push(`duplicate requirement id "${requirement.id}"`);
    }
    requirementIds.add(requirement.id);
  }
  for (const section of tour.sections) {
    if (sectionIds.has(section.id)) errors.push(`duplicate section id "${section.id}"`);
    sectionIds.add(section.id);
  }

  for (const section of tour.sections) {
    for (const { ref, ranges } of section.hunks) {
      if (!unitSet.has(ref)) {
        errors.push(`section "${section.id}" references unknown hunk "${ref}"`);
        continue;
      }
      errors.push(...rangeErrors(ref, ranges, hunksById.get(ref)));
      const previous = coveredBy.get(ref);
      if (previous) {
        errors.push(`hunk "${ref}" appears in both "${previous}" and "${section.id}"`);
      } else {
        coveredBy.set(ref, section.id);
      }
    }

    for (const finding of section.findings) {
      if (findingIds.has(finding.id)) errors.push(`duplicate finding id "${finding.id}"`);
      findingIds.add(finding.id);

      const resolved = resolveAnchor(finding.anchor, files);
      const label = `finding "${finding.id}"`;
      if (resolved.kind === "invalid") {
        errors.push(`${label}: ${resolved.reason}`);
      } else if (resolved.kind === "unanchored") {
        warnings.push(`${label}: ${resolved.reason}; it will be posted in the review body`);
      }
      if (finding.suggestion !== undefined) {
        if (resolved.kind !== "line" || finding.anchor.side !== "RIGHT") {
          errors.push(`${label}: suggestions need a RIGHT-side line that is in the diff`);
        }
      }
    }
  }

  const questioned = new Set<string>();
  for (const finding of tour.sections.flatMap((section) => section.findings)) {
    if (finding.severity !== "question") continue;
    const resolved = resolveAnchor(finding.anchor, files);
    questioned.add(resolved.kind === "line" ? resolved.hunkId : finding.anchor.path);
  }

  const implemented = new Set<string>();
  for (const section of tour.sections) {
    for (const { ref, why } of section.hunks) {
      const label = `hunk "${ref}"`;
      if (why.kind === "requirement") {
        for (const id of why.requirements) {
          if (requirementIds.has(id)) implemented.add(id);
          else errors.push(`${label} implements unknown requirement "${id}"`);
        }
      } else if (why.kind === "supporting") {
        for (const target of why.supports) {
          if (target === ref) errors.push(`${label} cannot support itself`);
          else if (!sectionIds.has(target) && !unitSet.has(target)) {
            errors.push(`${label} supports "${target}", which is neither a section nor a hunk`);
          }
        }
      } else if (why.kind === "unexplained" && !questioned.has(ref)) {
        errors.push(
          `${label} is unexplained, so it needs a question finding on one of its lines asking the author why`,
        );
      }
    }
  }

  for (const requirement of tour.requirements) {
    if (
      (requirement.status === "met" || requirement.status === "partial") &&
      !implemented.has(requirement.id)
    ) {
      errors.push(
        `requirement "${requirement.id}" is ${requirement.status}, but no hunk says it implements it`,
      );
    }
  }

  errors.push(...followUpErrors(tour, unitSet, findingIds, previous));

  const uncovered = units.filter((unit) => !coveredBy.has(unit));
  for (const unit of uncovered) errors.push(`hunk "${unit}" is not covered by any section`);

  return { errors, warnings, uncovered };
}

function followUpErrors(
  tour: Tour,
  units: Set<string>,
  openFindings: Set<string>,
  previous: PreviousRevision | null,
): string[] {
  if (!previous) {
    return tour.followUp.length > 0 ? ["followUp is only for revisions after the first"] : [];
  }
  const errors: string[] = [];
  const revision = `revision ${previous.changes.from.revision}`;
  const earlier = new Set(previous.tour.sections.flatMap((s) => s.findings.map((f) => f.id)));
  const changed = new Set(previous.changes.changed);
  const followedUp = new Set<string>();

  for (const { finding, status, refs } of tour.followUp) {
    const label = `followUp "${finding}"`;
    if (!earlier.has(finding)) {
      errors.push(`${label} is not a finding from ${revision}`);
      continue;
    }
    if (followedUp.has(finding)) errors.push(`${label} appears more than once`);
    if (openFindings.has(finding)) errors.push(`${label} is also still open in the sections`);
    followedUp.add(finding);
    if (status === "resolved" && refs.length === 0) {
      errors.push(`${label} is resolved, so it needs the refs of the hunks that fix it`);
    }
    for (const ref of refs) {
      if (!units.has(ref)) errors.push(`${label} references unknown hunk "${ref}"`);
      else if (status === "resolved" && !changed.has(ref)) {
        errors.push(
          `${label} says "${ref}" fixes it, but that hunk has not changed since ${revision}`,
        );
      }
    }
  }

  for (const id of earlier) {
    if (!openFindings.has(id) && !followedUp.has(id)) {
      errors.push(
        `finding "${id}" from ${revision} must stay open in a section with the same id or appear in followUp`,
      );
    }
  }
  return errors;
}
