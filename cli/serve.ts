import index from "../viewer/index.html";
import type { GitHubUser } from "../shared/schema.ts";
import {
  loadPrepared,
  loadOrSeedDraft,
  resolveRevision,
  resolveTour,
  revisionContext,
  type RevisionEntry,
  type TourEntry,
} from "./review-dir.ts";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

// Review data is private source code, so refuse requests whose Host header is
// not loopback; this blocks DNS-rebinding pages from reading the API.
function localOnly(handler: (req: Request) => Response | Promise<Response>) {
  return (req: Request) => {
    const host = new URL(req.url).hostname;
    if (!LOCAL_HOSTS.has(host)) return new Response("Forbidden", { status: 403 });
    return handler(req);
  };
}

export { handleDraftPut, reviewResponse, toursResponse } from "./service.ts";
import { handleDraftPut, reviewResponse, toursResponse } from "./service.ts";

function withRevision(
  dir: string,
  handler: (
    req: Request,
    entry: TourEntry,
    revision: RevisionEntry,
  ) => Response | Promise<Response>,
) {
  return localOnly((req) => {
    const params = new URL(req.url).searchParams;
    let entry: TourEntry;
    let revision: RevisionEntry;
    try {
      entry = resolveTour(dir, params.get("tour") ?? undefined);
      const rev = params.get("rev");
      revision = resolveRevision(entry, rev === null ? undefined : Number(rev));
    } catch (error) {
      return Response.json({ errors: [(error as Error).message] }, { status: 404 });
    }
    return handler(req, entry, revision);
  });
}

export function serve(options: { dir: string; port: number; viewer: GitHubUser }) {
  const { dir, viewer } = options;
  loadPrepared(dir);

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    development: Bun.env.PR_TOUR_DEV === "1",
    routes: {
      "/": index,
      "/api/tours": { GET: localOnly(() => Response.json(toursResponse(dir, viewer))) },
      "/api/review": {
        GET: withRevision(dir, (_, entry, revision) =>
          Response.json(reviewResponse(dir, entry, revision, viewer)),
        ),
      },
      "/api/draft": {
        GET: withRevision(dir, (_, entry, revision) =>
          Response.json(loadOrSeedDraft(revision, revisionContext(entry, revision), viewer)),
        ),
        PUT: withRevision(dir, async (req, entry, revision) =>
          handleDraftPut(entry, revision, viewer, await req.json()),
        ),
      },
    },
    fetch: () => new Response("Not found", { status: 404 }),
  });
  return server;
}
