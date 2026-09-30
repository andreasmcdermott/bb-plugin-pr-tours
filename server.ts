import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseArgs } from "node:util";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract } from "./host-contract.ts";
import { DraftSchema } from "./shared/schema.ts";
import {
  LibraryEntrySchema,
  ReviewResponseSchema,
  RevisionRefSchema,
  ToursResponseSchema,
  type LibraryEntry,
} from "./shared/wire.ts";
import { embedData } from "./cli/static-data.ts";
import { exportTemplate } from "./generated/export-template.ts";

const id = z.string().min(1);
export const rpcContract = defineRpcContract({
  list: {
    input: z.object({ threadId: z.string().optional() }),
    output: z.array(LibraryEntrySchema),
  },
  tours: { input: z.object({ id }), output: ToursResponseSchema },
  review: { input: z.object({ id, ref: RevisionRefSchema }), output: ReviewResponseSchema },
  draft: { input: z.object({ id, ref: RevisionRefSchema }), output: DraftSchema },
  save: {
    input: z.object({
      id,
      ref: RevisionRefSchema,
      draft: DraftSchema,
      viewerId: z.number().int().positive(),
    }),
    output: DraftSchema,
  },
});
export const CHANGED = "tours-changed";

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    "CREATE TABLE reviews (id TEXT PRIMARY KEY, hostId TEXT NOT NULL, dir TEXT NOT NULL, threadId TEXT, title TEXT NOT NULL, url TEXT NOT NULL, updatedAt TEXT NOT NULL, UNIQUE(hostId, dir))",
    "CREATE TABLE review_threads (reviewId TEXT NOT NULL, threadId TEXT NOT NULL, PRIMARY KEY (reviewId, threadId))",
  ]);
  function get(id: string): LibraryEntry {
    const entry = db.prepare("SELECT * FROM reviews WHERE id = ?").get(id);
    if (!entry) throw new Error(`Unknown review ${id}. Run bb pr-tours list.`);
    return LibraryEntrySchema.parse(entry);
  }
  function list(threadId?: string): LibraryEntry[] {
    const rows = threadId
      ? db
          .prepare(
            "SELECT r.* FROM reviews r JOIN review_threads t ON t.reviewId = r.id WHERE t.threadId = ? ORDER BY r.updatedAt DESC",
          )
          .all(threadId)
      : db.prepare("SELECT * FROM reviews ORDER BY updatedAt DESC").all();
    return z.array(LibraryEntrySchema).parse(rows);
  }
  function remember(
    hostId: string,
    result: { dir: string; pr: { title: string; url: string } },
    threadId?: string,
  ) {
    const old = db
      .prepare("SELECT id FROM reviews WHERE hostId = ? AND dir = ?")
      .get(hostId, result.dir) as { id: string } | undefined;
    const id = old?.id ?? randomUUID();
    db.prepare(
      "INSERT INTO reviews VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, url=excluded.url, updatedAt=excluded.updatedAt",
    ).run(
      id,
      hostId,
      result.dir,
      threadId ?? null,
      result.pr.title,
      result.pr.url,
      new Date().toISOString(),
    );
    if (threadId)
      db.prepare("INSERT OR IGNORE INTO review_threads VALUES (?, ?)").run(id, threadId);
    bb.realtime.publish(CHANGED, { id });
    return get(id);
  }
  bb.rpc.register(rpcContract, {
    list: ({ threadId }) => list(threadId),
    tours: ({ id }) => {
      const entry = get(id);
      return host.call("tours", { dir: entry.dir }, { hostId: entry.hostId });
    },
    review: async ({ id, ref }) => {
      const entry = get(id);
      const result = await host.call("review", { dir: entry.dir, ref }, { hostId: entry.hostId });
      return {
        ...result,
        syncCommand: `bb pr-tours sync ${id} --tour ${ref.tourId} --dry-run\nbb pr-tours sync ${id} --tour ${ref.tourId}`,
        reviseCommand: `bb pr-tours prepare ${entry.url}\nbb pr-tours revise ${id} --tour ${ref.tourId}`,
      };
    },
    draft: ({ id, ref }) => {
      const entry = get(id);
      return host.call("draft", { dir: entry.dir, ref }, { hostId: entry.hostId });
    },
    save: ({ id, ...input }) => {
      const entry = get(id);
      return host.call("save", { ...input, dir: entry.dir }, { hostId: entry.hostId });
    },
  });
  bb.http.route(
    "GET",
    "/export",
    async (ctx) => {
      try {
        const query = z.object({ id, tour: id }).strict().parse(ctx.req.query());
        const entry = get(query.id);
        const data = await host.call(
          "export",
          { dir: entry.dir, tourId: query.tour },
          { hostId: entry.hostId },
        );
        const pr = Object.values(data.reviews)[0]!.pr;
        const filename = `${pr.owner}-${pr.repo}-${pr.number}-tour.html`.replace(/[^\w.-]/g, "-");
        return new Response(embedData(exportTemplate, data), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-disposition": `attachment; filename="${filename}"`,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      } catch (error) {
        return ctx.json({ error: error instanceof Error ? error.message : String(error) }, 400);
      }
    },
    { auth: "local" },
  );

  const usage = `bb pr-tours prepare <PR URL | owner/repo#number> [--thread ID] [--host ID]
bb pr-tours import <absolute review directory> [--thread ID] [--host ID]
bb pr-tours list
bb pr-tours tours <review-id>
bb pr-tours new-tour <review-id> --model MODEL [--agent AGENT]
bb pr-tours write-tour <review-id> --tour <id> --file /absolute/tour.json
bb pr-tours revise <review-id> [--tour ID] [--model MODEL] [--agent AGENT]
bb pr-tours validate <review-id> [--tour ID]
bb pr-tours sync <review-id> [--tour ID] [--dry-run]

Open PR Tours in the BB sidebar, or the PR Tours tab in the thread panel.
Export HTML from the tour's toolbar. GitHub commands use gh on the review's host.`;
  bb.cli.register({
    name: "pr-tours",
    summary: "Prepare, write, validate, and sync guided PR reviews",
    commands: [
      "prepare",
      "import",
      "list",
      "tours",
      "new-tour",
      "write-tour",
      "revise",
      "validate",
      "sync",
    ].map((name) => ({
      name,
      usage: `bb pr-tours ${name}`,
      summary: usage.split("\n").find((line) => line.startsWith(`bb pr-tours ${name}`)) ?? name,
    })),
    async run(argv, context) {
      try {
        const { positionals, values } = parseArgs({
          args: argv,
          allowPositionals: true,
          options: {
            thread: { type: "string" },
            host: { type: "string" },
            tour: { type: "string" },
            model: { type: "string" },
            agent: { type: "string" },
            file: { type: "string" },
            "dry-run": { type: "boolean" },
            help: { type: "boolean", short: "h" },
          },
        });
        const [command, target] = positionals;
        if (!command || command === "help" || values.help) return { exitCode: 0, stdout: usage };
        if (command === "list") return { exitCode: 0, stdout: JSON.stringify(list(), null, 2) };
        if (!target) throw new Error(usage);
        const threadId = values.thread ?? context.threadId;
        if (command === "prepare" || command === "import") {
          const hostId =
            values.host ??
            (threadId
              ? (await bb.sdk.threads.storageLocation({ threadId })).hostId
              : (await bb.sdk.system.config()).primaryHostId);
          if (!hostId)
            throw new Error(
              "Pass --host with a connected BB machine, or run this command from a thread.",
            );
          const result =
            command === "prepare"
              ? await host.call(
                  "prepare",
                  { ref: target },
                  { hostId, timeoutMs: 180_000, signal: context.signal },
                )
              : await host.call(
                  "import",
                  {
                    dir: path.isAbsolute(target)
                      ? target
                      : path.resolve(context.cwd ?? ".", target),
                  },
                  { hostId, signal: context.signal },
                );
          const entry = remember(hostId, result, threadId);
          return {
            exitCode: 0,
            stdout: JSON.stringify(
              { ...entry, ...("warnings" in result ? { warnings: result.warnings } : {}) },
              null,
              2,
            ),
          };
        }
        const entry = get(target);
        if (threadId)
          db.prepare("INSERT OR IGNORE INTO review_threads VALUES (?, ?)").run(entry.id, threadId);
        if (command === "tours")
          return {
            exitCode: 0,
            stdout: JSON.stringify(
              await host.call("tours", { dir: entry.dir }, { hostId: entry.hostId }),
              null,
              2,
            ),
          };
        const action = z
          .enum(["new-tour", "write-tour", "revise", "validate", "sync"])
          .parse(command);
        const result = await host.call(
          "command",
          {
            dir: entry.dir,
            action,
            tour: values.tour,
            model: values.model,
            agent: values.agent,
            file: values.file ? path.resolve(context.cwd ?? ".", values.file) : undefined,
            dryRun: values["dry-run"],
          },
          { hostId: entry.hostId, timeoutMs: 180_000, signal: context.signal },
        );
        bb.realtime.publish(CHANGED, { id: entry.id });
        return {
          exitCode: result.valid ? 0 : 1,
          stdout: result.text.replaceAll("<review-id>", entry.id),
        };
      } catch (error) {
        return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
      }
    },
  });
}
