export type Side = "LEFT" | "RIGHT";

export type DiffLine = {
  kind: "context" | "add" | "del";
  oldLine: number | null;
  newLine: number | null;
  text: string;
  noNewlineAtEnd?: boolean;
};

export type Hunk = {
  id: string;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
};

export type FileStatus = "added" | "deleted" | "modified" | "renamed";

export type DiffFile = {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  binary: boolean;
  hunks: Hunk[];
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const DIFF_GIT = /^diff --git ("a\/(?:[^"\\]|\\.)*"|a\/.*?) ("b\/(?:[^"\\]|\\.)*"|b\/.*)$/;
const C_ESCAPES: Record<string, string> = {
  a: "\x07",
  b: "\b",
  t: "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
};
const utf8 = new TextDecoder();

// git C-quotes paths with special characters; octal escapes are UTF-8 bytes,
// so a run of them has to be decoded together.
function unquote(raw: string): string {
  const quoted = /^"(.*)"$/.exec(raw);
  if (!quoted) return raw;
  return quoted[1]!.replace(/(?:\\[0-7]{3})+|\\(.)/g, (seq, escaped?: string) =>
    escaped === undefined
      ? utf8.decode(Uint8Array.from(seq.slice(1).split("\\"), (octal) => parseInt(octal, 8)))
      : (C_ESCAPES[escaped] ?? escaped),
  );
}

// git ends a header path that contains a space with a tab.
function stripPrefix(raw: string, prefix: "a/" | "b/"): string | null {
  const path = unquote(raw.replace(/\t$/, ""));
  if (path === "/dev/null") return null;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

export function parseUnifiedDiff(patch: string): DiffFile[] {
  const lines = patch.split("\n");
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith("diff --git ")) {
      const match = DIFF_GIT.exec(line);
      const path = match ? unquote(match[2]!).slice(2) : line.slice("diff --git ".length);
      file = { path, oldPath: null, status: "modified", binary: false, hunks: [] };
      files.push(file);
      i++;
      continue;
    }

    if (!file) {
      i++;
      continue;
    }

    if (line.startsWith("new file mode")) {
      file.status = "added";
    } else if (line.startsWith("deleted file mode")) {
      file.status = "deleted";
    } else if (line.startsWith("rename from ")) {
      file.oldPath = unquote(line.slice("rename from ".length));
      file.status = "renamed";
    } else if (line.startsWith("rename to ")) {
      file.path = unquote(line.slice("rename to ".length));
    } else if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      file.binary = true;
    } else if (line.startsWith("--- ")) {
      const oldPath = stripPrefix(line.slice(4), "a/");
      if (oldPath === null) file.status = "added";
    } else if (line.startsWith("+++ ")) {
      const newPath = stripPrefix(line.slice(4), "b/");
      if (newPath === null) file.status = "deleted";
      else file.path = newPath;
    } else if (HUNK_HEADER.test(line)) {
      i = parseHunk(lines, i, file);
      continue;
    }
    i++;
  }

  for (const f of files) {
    if (f.status === "deleted" && f.oldPath === null) f.oldPath = f.path;
    f.hunks.forEach((hunk, index) => {
      hunk.id = `${f.path}#${index + 1}`;
    });
  }
  return files;
}

function parseHunk(lines: string[], start: number, file: DiffFile): number {
  const header = lines[start]!;
  const match = HUNK_HEADER.exec(header)!;
  const oldStart = Number(match[1]);
  const oldLines = match[2] === undefined ? 1 : Number(match[2]);
  const newStart = Number(match[3]);
  const newLines = match[4] === undefined ? 1 : Number(match[4]);
  const hunk: Hunk = { id: "", header, oldStart, oldLines, newStart, newLines, lines: [] };
  file.hunks.push(hunk);

  let oldNo = oldStart;
  let newNo = newStart;
  let oldLeft = oldLines;
  let newLeft = newLines;
  let i = start + 1;

  while (i < lines.length && (oldLeft > 0 || newLeft > 0)) {
    const line = lines[i]!;
    const marker = line[0];
    if (marker === "\\") {
      markNoNewline(hunk);
    } else if (marker === "+") {
      hunk.lines.push({ kind: "add", oldLine: null, newLine: newNo++, text: line.slice(1) });
      newLeft--;
    } else if (marker === "-") {
      hunk.lines.push({ kind: "del", oldLine: oldNo++, newLine: null, text: line.slice(1) });
      oldLeft--;
    } else {
      hunk.lines.push({ kind: "context", oldLine: oldNo++, newLine: newNo++, text: line.slice(1) });
      oldLeft--;
      newLeft--;
    }
    i++;
  }

  if (lines[i]?.startsWith("\\")) {
    markNoNewline(hunk);
    i++;
  }
  return i;
}

function markNoNewline(hunk: Hunk) {
  const last = hunk.lines.at(-1);
  if (last) last.noNewlineAtEnd = true;
}

// Every hunk is a coverage unit; files with no textual hunks (binary, pure
// rename, mode change) are covered as a whole by their path.
export function coverageUnits(files: DiffFile[]): string[] {
  return files.flatMap((f) => (f.hunks.length > 0 ? f.hunks.map((h) => h.id) : [f.path]));
}

export function lineIndex(hunk: Hunk, side: Side, line: number): number {
  return hunk.lines.findIndex((l) =>
    side === "RIGHT"
      ? l.kind !== "del" && l.newLine === line
      : l.kind !== "add" && l.oldLine === line,
  );
}

export function findHunkForLine(
  file: DiffFile,
  side: Side,
  line: number,
): { hunk: Hunk; index: number } | null {
  for (const hunk of file.hunks) {
    const index = lineIndex(hunk, side, line);
    if (index !== -1) return { hunk, index };
  }
  return null;
}
