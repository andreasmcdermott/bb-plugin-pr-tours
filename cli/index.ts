#!/usr/bin/env bun
import path from "node:path";
import { parseArgs } from "node:util";
import { validateTour } from "../shared/validate.ts";
import { exportTour } from "./export.ts";
import { currentUser, gh } from "./gh.ts";
import { formatOutline, formatTours, prepare } from "./prepare.ts";
import {
  createTour,
  latestRevision,
  listTours,
  loadPrepared,
  loadSnapshot,
  previousRevision,
  resolveReviewDir,
  resolveTour,
  reviewFile,
  revisionContext,
} from "./review-dir.ts";
import { revise } from "./revise.ts";
import { serve } from "./serve.ts";
import { sync } from "./sync.ts";

const USAGE = `Usage: pr-tour <command> [options]

Commands:
  prepare <pr-url | owner/repo#n> [--dir DIR]   Fetch the PR and its SHA-pinned diff
  tours <dir>                                   List the tours already written for the PR
  new-tour <dir> --model MODEL [--agent AGENT]  Start a tour owned by you; prints where to
                                                write tour.json
  revise <dir> [--tour ID] [--model M] [--agent A]
                                                Start the next revision of your tour after
                                                prepare picked up new commits
  validate <dir> [--tour ID]                    Check the latest tour.json against its diff
  serve <dir> [--tour ID] [--port 4600]         Open the guided review locally
  sync <dir> [--tour ID] [--dry-run] [--allow-outdated] [--force]
                                                Post the finished review to GitHub as you
  export <dir> [--tour ID] [--out DIR]
                                                Write the tours to one read-only HTML file
                                                to share with people who may read the code

<dir> is the PR (a URL or owner/repo#n), its review directory's name, or a path.
Review directories live in ~/pr-tours, or in $PR_TOUR_HOME when it is set.

--tour can be left out when the PR has only one tour. Commands act on the tour's
latest revision.
`;

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dir: { type: "string" },
      tour: { type: "string" },
      model: { type: "string" },
      agent: { type: "string" },
      port: { type: "string", default: "4600" },
      out: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "allow-outdated": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, target] = positionals;

  if (values.help || !command || !target) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  const dir = resolveReviewDir(target);

  switch (command) {
    case "prepare": {
      const result = await prepare({
        gh,
        ref: target,
        dir: values.dir ? path.resolve(values.dir) : undefined,
      });
      const { pr, files } = result;
      console.log(`Prepared ${pr.owner}/${pr.repo}#${pr.number} at ${pr.headSha}: ${pr.title}`);
      console.log(`Review directory: ${result.dir}`);
      console.log(`\nCoverage units (${files.length} files):\n${formatOutline(files)}`);
      if (result.tours.length > 0) {
        console.log(`\nExisting tours:\n${formatTours(result.tours, pr.headSha)}`);
      }
      for (const warning of result.warnings) console.warn(`warning: ${warning}`);
      return 0;
    }
    case "tours": {
      const { pr } = loadPrepared(dir);
      const tours = listTours(dir);
      console.log(tours.length > 0 ? formatTours(tours, pr.headSha) : "No tours yet");
      return 0;
    }
    case "new-tour": {
      if (!values.model) {
        console.error("new-tour needs --model, for example --model claude-opus-5-5");
        return 1;
      }
      const entry = createTour(dir, {
        model: values.model,
        agent: values.agent,
        author: await currentUser(gh),
      });
      console.log(`Created tour ${entry.id} for ${entry.meta.author.login}`);
      const [first] = entry.revisions;
      console.log(`Write the tour to ${path.join(first!.dir, reviewFile.tour)}`);
      return 0;
    }
    case "revise": {
      const result = await revise({
        gh,
        dir,
        tour: values.tour,
        model: values.model,
        agent: values.agent,
      });
      const { entry, previous, revision, changes } = result;
      const list = (refs: string[]) => (refs.length > 0 ? refs.join(", ") : "none");
      console.log(
        `Started r${revision.revision} of tour ${entry.id} at ${revision.meta.headSha} ` +
          `(r${previous.revision} was at ${previous.meta.headSha})`,
      );
      console.log(`Previous tour: ${path.join(previous.dir, reviewFile.tour)}`);
      console.log(`Changes: ${path.join(revision.dir, reviewFile.changes)}`);
      console.log(`  changed or new: ${list(changes.changed)}`);
      const gone = changes.dropped.filter((ref) => !changes.changed.includes(ref));
      console.log(`  no longer in the diff: ${list(gone)}`);
      console.log(`  unchanged: ${changes.carried.length}`);
      console.log(`Findings to follow up: ${list(result.openFindings)}`);
      console.log(`Write the new tour to ${path.join(revision.dir, reviewFile.tour)}`);
      return 0;
    }
    case "validate": {
      const entry = resolveTour(dir, values.tour);
      const revision = latestRevision(entry);
      const { pr, files } = loadSnapshot(revision);
      const loaded = revision.load;
      if (loaded.status === "missing") {
        console.error(`${path.join(revision.dir, reviewFile.tour)} does not exist yet`);
        return 1;
      }
      const errors = loaded.status === "invalid" ? loaded.errors : [];
      const warnings: string[] = [];
      if (loaded.status === "ok") {
        const previous = previousRevision(revisionContext(entry, revision));
        const validation = validateTour(loaded.tour, pr, files, previous);
        errors.push(...validation.errors);
        warnings.push(...validation.warnings);
      }
      for (const warning of warnings) console.warn(`warning: ${warning}`);
      for (const error of errors) console.error(`error: ${error}`);
      if (errors.length > 0) return 1;
      console.log(`Tour ${entry.id} r${revision.revision} is valid and covers every hunk`);
      return 0;
    }
    case "serve": {
      const { pr } = loadPrepared(dir);
      const url = values.tour ? `?tour=${resolveTour(dir, values.tour).id}` : "";
      const server = serve({ dir, port: Number(values.port), viewer: await currentUser(gh) });
      console.log(`Reviewing ${pr.owner}/${pr.repo}#${pr.number} at ${server.url}${url}`);
      return new Promise<number>(() => {});
    }
    case "sync": {
      const result = await sync({
        gh,
        dir,
        tour: values.tour,
        dryRun: values["dry-run"],
        allowOutdated: values["allow-outdated"],
        force: values.force,
      });
      const { payload } = result;
      console.log(`${payload.event} with ${payload.comments.length} line comments`);
      if (result.status === "dry-run") {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`Posted: ${result.url}`);
        for (const warning of result.warnings) console.warn(`warning: ${warning}`);
      }
      return 0;
    }
    case "export": {
      const out = path.resolve(values.out ?? path.join(dir, "export"));
      const result = exportTour({ dir, tour: values.tour, out });
      const size = (result.bytes / 1024 / 1024).toFixed(1);
      const tours = `${result.tours} ${result.tours === 1 ? "tour" : "tours"}`;
      console.log(`Wrote ${tours} to ${result.file} (${size} MB)`);
      console.log(
        "Open it in a browser, send it to someone, or upload it to any static host. It " +
          "contains the full diff, so only share it with people who may read the code.",
      );
      return 0;
    }
    default:
      console.error(`unknown command "${command}"\n\n${USAGE}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
