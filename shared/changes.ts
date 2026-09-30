import type { DiffFile } from "./diff.ts";
import type { Changes, Draft, Tour } from "./schema.ts";

type Snapshot = { revision: number; headSha: string; files: DiffFile[] };

// A unit's identity is its path plus the lines it adds and removes. Line
// numbers and context are left out so that a rebase or an edit elsewhere in the
// file does not make an untouched hunk look new. Binary files have no content
// to compare, so they always count as changed.
function unitKey(file: DiffFile, hunk: DiffFile["hunks"][number] | null): string | null {
  if (!hunk) {
    return file.binary ? null : [file.path, file.status, file.oldPath ?? ""].join("\n");
  }
  const lines = hunk.lines
    .filter((line) => line.kind !== "context")
    .map((line) => `${line.kind === "add" ? "+" : "-"}${line.text}`);
  return [file.path, ...lines].join("\n");
}

function units(files: DiffFile[]): { ref: string; key: string | null }[] {
  return files.flatMap((file) =>
    file.hunks.length === 0
      ? [{ ref: file.path, key: unitKey(file, null) }]
      : file.hunks.map((hunk) => ({ ref: hunk.id, key: unitKey(file, hunk) })),
  );
}

export function computeChanges(from: Snapshot, to: Snapshot): Changes {
  const previousByKey = new Map<string, string[]>();
  for (const { ref, key } of units(from.files)) {
    if (key !== null) previousByKey.set(key, [...(previousByKey.get(key) ?? []), ref]);
  }
  const matched = new Set<string>();
  const carried: Changes["carried"] = [];
  const changed: string[] = [];
  for (const { ref, key } of units(to.files)) {
    const previous = key === null ? undefined : previousByKey.get(key)?.shift();
    if (previous === undefined) {
      changed.push(ref);
    } else {
      carried.push({ ref, previous });
      matched.add(previous);
    }
  }
  const dropped = units(from.files)
    .map(({ ref }) => ref)
    .filter((ref) => !matched.has(ref));
  return {
    from: { revision: from.revision, headSha: from.headSha },
    to: { revision: to.revision, headSha: to.headSha },
    carried,
    changed,
    dropped,
  };
}

export function unchangedSections(tour: Tour, changes: Changes, previous: Tour): Set<string> {
  const carried = new Set(changes.carried.map(({ ref }) => ref));
  const previousFindings = new Set(previous.sections.flatMap((s) => s.findings.map((f) => f.id)));
  return new Set(
    tour.sections
      .filter(
        (section) =>
          section.hunks.length > 0 &&
          section.hunks.every(({ ref }) => carried.has(ref)) &&
          section.findings.every(({ id }) => previousFindings.has(id)),
      )
      .map((section) => section.id),
  );
}

export function seedViewedSections(
  tour: Tour,
  changes: Changes,
  previous: { tour: Tour; draft: Draft },
): string[] {
  const previousRef = new Map(changes.carried.map(({ ref, previous: from }) => [ref, from]));
  const viewedBefore = new Set(
    previous.tour.sections
      .filter((section) => previous.draft.viewedSections.includes(section.id))
      .flatMap((section) => section.hunks.map(({ ref }) => ref)),
  );
  const unchanged = unchangedSections(tour, changes, previous.tour);
  return tour.sections
    .filter(
      (section) =>
        unchanged.has(section.id) &&
        section.hunks.every(({ ref }) => viewedBefore.has(previousRef.get(ref) ?? "")),
    )
    .map((section) => section.id);
}
