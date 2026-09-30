import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_useCodeTheme,
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginNavPanelProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server.ts";
import type { LibraryEntry } from "./shared/wire.ts";
import type { RevisionRef } from "./viewer/api.ts";
import type { TourApi } from "./viewer/runtime.tsx";
import { App } from "./viewer/App.tsx";
import "./viewer/styles.css";
import "./app.css";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function ExportButton({ id, tourId }: { id: string; tourId?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function download() {
    if (!tourId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/plugins/pr-tours/http/export?${new URLSearchParams({ id, tour: tourId })}`,
      );
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Export failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
        "pr-tour.html";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="button" disabled={busy || !tourId} onClick={() => void download()}>
        {busy ? "Exporting…" : "Export HTML"}
      </button>
      {error && (
        <span role="alert" className="export-error">
          {error}
        </span>
      )}
    </>
  );
}

function ReviewPage({
  entry,
  initialRef,
  back,
  navigate,
  refresh,
}: {
  entry: LibraryEntry;
  initialRef?: Partial<RevisionRef>;
  back: () => void;
  refresh: () => void;
  navigate?: (ref: RevisionRef) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const theme = experimental_useCodeTheme();
  const flushers = useRef(new Set<() => Promise<void>>());
  const [selected, setSelected] = useState(initialRef);
  const api = useMemo<TourApi>(() => {
    let viewerId: number | undefined;
    const versions = new Map<string, string>();
    return {
      flush: async () => {
        await Promise.all([...flushers.current].map((flush) => flush()));
      },
      registerFlush: (flush) => {
        flushers.current.add(flush);
        return () => {
          flushers.current.delete(flush);
        };
      },
      fetchTours: async () => {
        const result = await rpc.call("tours", { id: entry.id });
        viewerId = result.viewer.id;
        setSelected((current) => (current?.tourId ? current : { tourId: result.tours[0]?.id }));
        return result;
      },
      fetchReview: (ref) => {
        setSelected(ref);
        return rpc.call("review", { id: entry.id, ref });
      },
      fetchDraft: async (ref) => {
        const state = await rpc.call("draft", { id: entry.id, ref });
        versions.set(`${ref.tourId}@${ref.revision}`, state.version);
        return state.draft;
      },
      checkFreshness: () => rpc.call("freshness", { id: entry.id }),
      previewReview: (ref) => rpc.call("preview", { id: entry.id, ref, viewerId: viewerId! }),
      postReview: (ref, token) =>
        rpc.call("post", { id: entry.id, ref, token, viewerId: viewerId! }),
      saveDraft: async (ref, draft) => {
        if (!viewerId)
          return Promise.reject(new Error("Load the reviewer identity before editing"));
        const key = `${ref.tourId}@${ref.revision}`;
        const expectedVersion = versions.get(key);
        if (!expectedVersion) throw new Error("Load the draft before editing");
        const state = await rpc.call("save", {
          id: entry.id,
          ref,
          draft,
          viewerId,
          expectedVersion,
        });
        versions.set(key, state.version);
        return state.draft;
      },
    };
  }, [entry.id, rpc]);
  const [updated, setUpdated] = useState(false);
  const [linkMessage, setLinkMessage] = useState("");
  useRealtime("tours-changed", (payload) => {
    const event = payload as { id?: string; kind?: string };
    if (event.id === entry.id && event.kind !== "draft" && event.kind !== "archive")
      setUpdated(true);
  });
  const copyLink = async () => {
    try {
      const ref =
        selected?.tourId && selected.revision
          ? { tourId: selected.tourId, revision: selected.revision }
          : undefined;
      const url = await rpc.call("link", { id: entry.id, ...(ref ? { ref } : {}) });
      await navigator.clipboard.writeText(url);
      setLinkMessage("Link copied");
    } catch (error) {
      setLinkMessage(message(error));
    }
  };
  const leave = (action: () => void) => {
    void api.flush!().then(action, () => {});
  };
  return (
    <div className="pr-tours-embedded" style={{ colorScheme: theme.mode }}>
      <App
        api={api}
        initialRef={initialRef}
        onNavigate={(ref) => {
          setSelected(ref);
          navigate?.(ref);
        }}
        toolbar={
          <div className="tour-toolbar">
            <button className="button button--quiet" onClick={() => leave(back)}>
              ← All PRs
            </button>
            <button className="button button--quiet" onClick={() => leave(refresh)}>
              Refresh tours
            </button>
            {updated && <span role="status">Tour updated. Refresh to load it.</span>}
            <span className="toolbar-spacer" />
            <button className="button button--quiet" onClick={() => void copyLink()}>
              Copy tour link
            </button>
            {linkMessage && <span role="status">{linkMessage}</span>}
            <ExportButton id={entry.id} tourId={selected?.tourId} />
          </div>
        }
      />
    </div>
  );
}

function Library({
  threadId,
  requestedId,
  initialRef,
  select,
}: {
  threadId?: string;
  requestedId?: string;
  initialRef?: Partial<RevisionRef>;
  select?: (id: string | null, ref?: RevisionRef) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localId, setLocalId] = useState<string | null>(null);
  const [all, setAll] = useState(!threadId);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [generation, setGeneration] = useState(0);
  const load = useCallback(() => {
    rpc
      .call("list", {
        ...(all || !threadId ? {} : { threadId }),
        archived,
        ...(requestedId ? { includeId: requestedId } : {}),
      })
      .then(
        (value) => {
          setEntries(value);
          setError(null);
        },
        (error) => setError(message(error)),
      );
  }, [rpc, all, threadId, archived, requestedId]);
  useEffect(load, [load]);
  useRealtime("tours-changed", load);
  const id = requestedId ?? localId;
  const choose = (id: string | null, ref?: RevisionRef) => {
    setLocalId(id);
    select?.(id, ref);
  };
  const entry = entries?.find((entry) => entry.id === id);
  if (entry)
    return (
      <ReviewPage
        key={`${entry.id}:${initialRef?.tourId ?? ""}:${initialRef?.revision ?? ""}:${generation}`}
        entry={entry}
        initialRef={initialRef}
        back={() => choose(null)}
        refresh={() => setGeneration((value) => value + 1)}
        navigate={(ref) => select?.(entry.id, ref)}
      />
    );
  return (
    <div className="pr-tours-library">
      <div className="library-heading">
        <div>
          <h2>Guided PR reviews</h2>
          <p>
            Read the change in the agent’s suggested order, review findings, and keep your decisions
            with the tour.
          </p>
        </div>
        <button
          onClick={() => {
            load();
            setGeneration((value) => value + 1);
          }}
        >
          Refresh
        </button>
      </div>
      {threadId && (
        <label className="library-filter">
          <input type="checkbox" checked={all} onChange={(event) => setAll(event.target.checked)} />{" "}
          Show reviews from all threads
        </label>
      )}
      <div className="library-controls">
        <input
          aria-label="Search reviews"
          placeholder="Search by title, repository, or PR number"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
          />{" "}
          Show archived reviews
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {id && entries && !entry && <p role="alert">This review is not in the current list.</p>}
      {!entries ? (
        <p role="status">Loading reviews…</p>
      ) : entries.length === 0 ? (
        <div className="library-empty">
          <h3>No tours yet</h3>
          <p>
            Run <code>/pr-tour 123</code> in a thread to create a guided review.
          </p>
          <p>
            To bring in an existing review, use{" "}
            <code>bb pr-tours import /absolute/path/to/review</code>.
          </p>
        </div>
      ) : (
        <ul className="library-list">
          {entries
            .filter((entry) =>
              `${entry.title} ${entry.url}`.toLowerCase().includes(query.toLowerCase()),
            )
            .map((entry) => (
              <LibraryCard
                key={entry.id}
                entry={entry}
                choose={() => choose(entry.id)}
                refresh={load}
              />
            ))}
          {entries.length > 0 &&
            !entries.some((entry) =>
              `${entry.title} ${entry.url}`.toLowerCase().includes(query.toLowerCase()),
            ) && <li>No matching reviews.</li>}
        </ul>
      )}
    </div>
  );
}

function LibraryCard({
  entry,
  choose,
  refresh,
}: {
  entry: LibraryEntry;
  choose: () => void;
  refresh: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [progress, setProgress] = useState("Checking progress…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    rpc.call("progress", { id: entry.id }).then(
      (value) => {
        const labels = {
          "not-started": "Not started",
          "in-progress": "In progress",
          ready: "Ready to post",
          posted: "Posted",
        };
        if (active)
          setProgress(`${labels[value.status]} · ${value.viewed}/${value.total} sections viewed`);
      },
      () => {
        if (active)
          setProgress("Progress unavailable. Check that the review's machine is connected.");
      },
    );
    return () => {
      active = false;
    };
  }, [rpc, entry]);
  return (
    <li>
      <button onClick={choose}>
        <strong>{entry.title}</strong>
        <span>{entry.url.replace("https://github.com/", "")}</span>
        <small>{progress}</small>
      </button>
      <button
        disabled={busy}
        className="library-archive"
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await rpc.call("archive", { id: entry.id, archived: !entry.archived });
            refresh();
          } catch (error) {
            setError(message(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        {entry.archived ? "Restore" : "Archive"}
      </button>
      {error && <p role="alert">{error}</p>}
    </li>
  );
}

function ToursPage({ subPath }: PluginNavPanelProps) {
  const navigate = useBbNavigate();
  const [id, tourId, revision] = subPath.split("/").map(decodeURIComponent);
  return (
    <Library
      requestedId={id || undefined}
      initialRef={tourId ? { tourId, revision: Number(revision) || undefined } : undefined}
      select={(id, ref) =>
        navigate.toPluginPanel("tours", {
          subPath: id
            ? [id, ...(ref ? [ref.tourId, String(ref.revision)] : [])]
                .map(encodeURIComponent)
                .join("/")
            : "",
        })
      }
    />
  );
}
function ThreadTours({ threadId }: PluginThreadPanelProps) {
  return <Library threadId={threadId} />;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tours",
    title: "PR Tours",
    icon: "GitPullRequest",
    path: "tours",
    component: ToursPage,
  });
  app.slots.threadPanelAction({
    id: "tours",
    title: "PR Tours",
    icon: "GitPullRequest",
    layout: "flush",
    component: ThreadTours,
  });
});
