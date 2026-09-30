import { writeFileSync } from "node:fs";
import path from "node:path";
import { parseUnifiedDiff, type DiffFile } from "../shared/diff.ts";
import type { PrMeta } from "../shared/schema.ts";
import { ghJson, type Gh } from "./gh.ts";
import {
  defaultReviewDir,
  latestRevision,
  listTours,
  parsePrRef,
  reviewFile,
  writeJson,
  type TourEntry,
} from "./review-dir.ts";

type PullResponse = {
  html_url: string;
  title: string;
  body: string | null;
  user: { login: string };
  changed_files: number;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
};

export async function prepare(options: {
  gh: Gh;
  ref: string;
  dir?: string;
  now?: () => Date;
}): Promise<{
  dir: string;
  pr: PrMeta;
  files: DiffFile[];
  tours: TourEntry[];
  warnings: string[];
}> {
  const { owner, repo, number } = parsePrRef(options.ref);
  const dir = options.dir ?? defaultReviewDir({ owner, repo, number });
  const warnings: string[] = [];
  const repoPath = `repos/${owner}/${repo}`;

  const pull = await ghJson<PullResponse>(options.gh, ["api", `${repoPath}/pulls/${number}`]);
  const range = `${pull.base.sha}...${pull.head.sha}`;
  const patch = await options.gh([
    "api",
    "-H",
    "Accept: application/vnd.github.diff",
    `${repoPath}/compare/${range}`,
  ]);
  const mergeBaseSha = (
    await options.gh(["api", `${repoPath}/compare/${range}`, "--jq", ".merge_base_commit.sha"])
  ).trim();
  const files = parseUnifiedDiff(patch);

  if (files.length !== pull.changed_files) {
    warnings.push(
      `GitHub reports ${pull.changed_files} changed files but the diff has ${files.length}; the diff may be truncated`,
    );
  }

  const pr: PrMeta = {
    owner,
    repo,
    number,
    url: pull.html_url,
    title: pull.title,
    body: pull.body ?? "",
    author: pull.user.login,
    baseRef: pull.base.ref,
    headRef: pull.head.ref,
    mergeBaseSha,
    headSha: pull.head.sha,
    preparedAt: (options.now?.() ?? new Date()).toISOString(),
  };

  const tours = listTours(dir);
  for (const tour of tours) {
    const { revision, meta } = latestRevision(tour);
    if (meta.headSha === pr.headSha) continue;
    warnings.push(
      `tour ${tour.id} r${revision} was written for ${meta.headSha.slice(0, 7)}; ` +
        `run \`pr-tour revise ${dir} --tour ${tour.id}\` to review the new commits`,
    );
  }

  writeJson(path.join(dir, reviewFile.pr), pr);
  writeJson(path.join(dir, reviewFile.diff), files);
  writeFileSync(path.join(dir, reviewFile.patch), patch);
  return { dir, pr, files, tours, warnings };
}

export function formatTours(tours: TourEntry[], headSha: string): string {
  return tours
    .map((tour) => {
      const { author, model, agent, createdAt } = tour.meta;
      const { revision, meta, load } = latestRevision(tour);
      const state =
        load.status !== "ok"
          ? `tour.json ${load.status}`
          : meta.headSha === headSha
            ? "current"
            : `outdated, written for ${meta.headSha.slice(0, 7)}`;
      const by = agent ? `${model} via ${agent}` : model;
      return `  ${tour.id} r${revision}  ${by}, by ${author.login} at ${createdAt}  (${state})`;
    })
    .join("\n");
}

export function formatOutline(files: DiffFile[]): string {
  return files
    .flatMap((file) => {
      if (file.hunks.length === 0) {
        const what = file.binary
          ? "binary"
          : file.oldPath
            ? `renamed from ${file.oldPath}`
            : "no text changes";
        return [`  ${file.path}  (${what})`];
      }
      return file.hunks.map((hunk) => {
        const added = hunk.lines.filter((l) => l.kind === "add").length;
        const removed = hunk.lines.filter((l) => l.kind === "del").length;
        const range = hunk.header.match(/^@@ [^@]+ @@/)?.[0] ?? hunk.header;
        return `  ${hunk.id}  ${range}  +${added} -${removed}`;
      });
    })
    .join("\n");
}
