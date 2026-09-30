import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { postedFindings } from "../shared/review.ts";
import type { Draft } from "../shared/schema.ts";
import { isStatic, type ReviewResponse, type RevisionRef, type TourSummary } from "./api.ts";
import { createDraftSaver } from "./autosave.ts";
import { TourApiContext, TourRootContext, useTourApi, type TourApi } from "./runtime.tsx";
import { FinishReview } from "./components/FinishReview.tsx";
import { Markdown } from "./components/Markdown.tsx";
import { Requirements } from "./components/Requirements.tsx";
import { Section } from "./components/Section.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { SinceRevision } from "./components/SinceRevision.tsx";
import { TourPicker } from "./components/TourPicker.tsx";
import { Unexplained } from "./components/Unexplained.tsx";
import { draftReducer, type DraftAction } from "./draft.ts";
import { buildSections, sinceRevision, unexplainedHunks, type RevisionView } from "./tour-model.ts";

export type Dispatch = (action: DraftAction) => void;

const reading = isStatic;

type SaveState = { status: "saved" } | { status: "saving" } | { status: "error"; message: string };

export function App({
  api,
  initialRef,
  toolbar,
  onNavigate,
}: {
  api?: TourApi;
  initialRef?: Partial<RevisionRef>;
  toolbar?: React.ReactNode;
  onNavigate?: (ref: RevisionRef) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <TourRootContext.Provider value={root}>
      <div
        className="pr-tour-root"
        onClick={(event) => {
          const anchor = (event.target as HTMLElement).closest('a[href^="#"]');
          if (!anchor) return;
          event.preventDefault();
          const target = decodeURIComponent(anchor.getAttribute("href")!.slice(1));
          root.current?.dispatchEvent(new CustomEvent("tour-jump", { detail: target }));
          requestAnimationFrame(() =>
            root.current
              ?.querySelector(`[id="${CSS.escape(target)}"]`)
              ?.scrollIntoView({ block: "start" }),
          );
        }}
      >
        {toolbar}
        <div className="pr-tour-scroll" ref={root}>
          {api ? (
            <TourApiContext.Provider value={api}>
              <TourApp initialRef={initialRef} onNavigate={onNavigate} />
            </TourApiContext.Provider>
          ) : (
            <TourApp initialRef={initialRef} onNavigate={onNavigate} />
          )}
        </div>
      </div>
    </TourRootContext.Provider>
  );
}

function TourApp({
  initialRef,
  onNavigate,
}: {
  initialRef?: Partial<RevisionRef>;
  onNavigate?: (ref: RevisionRef) => void;
}) {
  const { fetchTours, flush } = useTourApi();
  const [selection, setSelection] = useState(initialRef);
  const navigate = (ref: RevisionRef) => {
    void (flush?.() ?? Promise.resolve()).then(
      () => {
        setSelection(ref);
        onNavigate?.(ref);
      },
      () => {},
    );
  };
  const [tours, setTours] = useState<TourSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTours().then(
      (response) => setTours(response.tours),
      (e: Error) => setError(e.message),
    );
  }, [fetchTours]);

  if (error) return <div className="fatal">{error}</div>;
  if (!tours) return <div className="loading">Loading tours…</div>;
  const params = new URLSearchParams(window.location.search);
  const requested = selection?.tourId ?? params.get("tour");
  const tour = tours.find((t) => t.id === requested) ?? tours[0];
  if (!tour) {
    return (
      <div className="fatal">
        This PR has no tours yet. Ask your agent to run <code>bb pr-tours new-tour</code> and write
        one.
      </div>
    );
  }
  const rev = selection?.revision ?? Number(params.get("rev"));
  const revision = Number.isInteger(rev) && rev > 0 ? rev : tour.revision;
  const ref = { tourId: tour.id, revision };
  return (
    <>
      <TourLoader
        key={`${tour.id}@${revision}`}
        revisionRef={ref}
        tours={tours}
        onNavigate={navigate}
      />
    </>
  );
}

function TourLoader({
  revisionRef: requestedRef,
  tours,
  onNavigate,
}: {
  revisionRef: RevisionRef;
  tours: TourSummary[];
  onNavigate: (ref: RevisionRef) => void;
}) {
  const { fetchReview, fetchDraft } = useTourApi();
  const revisionRef = useMemo(() => requestedRef, [requestedRef.tourId, requestedRef.revision]);
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftGeneration, setDraftGeneration] = useState(0);
  const resetDraft = async () => {
    try {
      const value = await fetchDraft(revisionRef);
      setDraft(value);
      setDraftGeneration((v) => v + 1);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const reload = useCallback(() => {
    fetchReview(revisionRef).then(setReview, (e: Error) => setError(e.message));
  }, [revisionRef, fetchReview]);

  useEffect(() => {
    reload();
    fetchDraft(revisionRef).then(setDraft, (e: Error) => setError(e.message));
  }, [reload, revisionRef, fetchDraft]);

  if (error) return <div className="fatal">{error}</div>;
  if (!review || !draft) return <div className="loading">Loading review…</div>;
  return (
    <Review
      key={draftGeneration}
      resetDraft={() => void resetDraft()}
      review={review}
      initialDraft={draft}
      tours={tours}
      revisionRef={revisionRef}
      onReload={reload}
      onNavigate={onNavigate}
    />
  );
}

function useAutosave(ref: RevisionRef, draft: Draft, initial: Draft) {
  const { saveDraft, registerFlush } = useTourApi();
  const [state, setState] = useState<SaveState>({ status: "saved" });
  const saver = useMemo(
    () => createDraftSaver(initial, (value) => saveDraft(ref, value), setState),
    [ref, saveDraft, initial],
  );
  useEffect(() => {
    saver.enqueue(draft);
  }, [saver, draft]);
  useEffect(() => registerFlush?.(saver.flush), [saver, registerFlush]);
  useEffect(
    () => () => {
      void saver.flush().catch(() => {});
    },
    [saver],
  );

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (state.status !== "saved") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.status]);
  return { ...state, retry: saver.flush, cancel: saver.cancel };
}

function Review({
  resetDraft,
  review,
  initialDraft,
  tours,
  revisionRef,
  onReload,
  onNavigate,
}: {
  resetDraft: () => void;
  review: ReviewResponse;
  initialDraft: Draft;
  tours: TourSummary[];
  revisionRef: RevisionRef;
  onReload: () => void;
  onNavigate: (ref: RevisionRef) => void;
}) {
  const [draft, dispatch] = useReducer(draftReducer, initialDraft);
  const save = useAutosave(revisionRef, draft, initialDraft);
  const api = useTourApi();
  const [freshness, setFreshness] = useState<{
    headSha: string;
    state: string;
    checkedAt: string;
  } | null>(null);
  const [freshnessError, setFreshnessError] = useState("");
  const checkFreshness = useCallback(() => {
    api.checkFreshness?.().then(
      (value) => {
        setFreshness(value);
        setFreshnessError("");
      },
      (error) => setFreshnessError(error instanceof Error ? error.message : String(error)),
    );
  }, [api]);
  useEffect(() => {
    checkFreshness();
  }, [checkFreshness]);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const downloadDraft = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pr-${review.pr.number}-draft.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const reset = () => {
    void save.cancel().then(resetDraft);
  };
  const { pr, tour, files, validation, meta, isAuthor, isLatest, history } = review;
  const current = review.revision;
  const sections = useMemo(
    () => buildSections(tour, files, validation?.uncovered ?? []),
    [tour, files, validation],
  );
  const sectionTitles = useMemo(
    () => new Map(sections.map((section) => [section.id, section.title])),
    [sections],
  );
  const unexplained = useMemo(() => (tour ? unexplainedHunks(tour) : []), [tour]);
  const revisionView = useMemo<RevisionView | null>(
    () =>
      review.previous && review.changes
        ? {
            previous: review.previous.revision,
            changed: new Set(review.changes.changed),
            unchanged: new Set(review.unchangedSections),
          }
        : null,
    [review],
  );
  const since = useMemo(
    () =>
      tour && review.previous && review.changes
        ? sinceRevision(tour, review.previous.tour, review.changes)
        : null,
    [tour, review],
  );
  const posted = useMemo(() => postedFindings(history), [history]);
  const latest = review.revisions.at(-1)!;
  const liveHeadSha = freshness?.headSha ?? review.liveHeadSha;
  const outdated = isLatest && liveHeadSha !== current.headSha;
  const locked = !isLatest || draft.readyAt !== null || draft.synced !== null;
  const readOnly = reading || locked;
  const findingsReadOnly = readOnly || !isAuthor;
  const viewedReadOnly = !reading && locked;
  const problems = [...review.tourErrors, ...(validation?.errors ?? [])];

  return (
    <div className="layout">
      <Sidebar
        sections={sections}
        draft={draft}
        hasRequirements={(tour?.requirements.length ?? 0) > 0}
        unexplained={unexplained.length}
        revisionView={revisionView}
        finish={!reading}
      />
      <main className="main">
        <header className="pr-header" id="summary">
          <div className="pr-header__meta">
            <a href={pr.url} target="_blank" rel="noreferrer">
              {pr.owner}/{pr.repo}#{pr.number}
            </a>
            <span>
              by {pr.author} · {pr.headRef} → {pr.baseRef} · <code>{pr.headSha.slice(0, 7)}</code> ·
              r{current.revision}
            </span>
            {!isStatic && <span>Reviewing as {review.viewer.login}</span>}
            {!reading && (
              <span className={`save save--${save.status}`}>
                {save.status === "error" ? `Not saved: ${save.message}` : save.status}
              </span>
            )}
            {!isStatic && (
              <button type="button" className="button button--quiet" onClick={onReload}>
                Reload tour
              </button>
            )}
          </div>
          <h1>{pr.title}</h1>
          <TourPicker
            tours={tours}
            tourId={revisionRef.tourId}
            liveHeadSha={liveHeadSha}
            revisions={review.revisions}
            revision={current.revision}
            onNavigate={onNavigate}
          />
          {tour && tour.stories.length > 0 && (
            <div className="stories">
              {tour.stories.map((story) => (
                <a
                  key={story.id}
                  className="story"
                  href={story.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <strong>{story.id}</strong> {story.title}
                </a>
              ))}
            </div>
          )}
        </header>

        {!reading && save.status === "error" && (
          <div className="banner banner--error" role="alert">
            <p>Your latest edits are not saved. {save.message}</p>
            <button className="button" onClick={() => void save.retry().catch(() => {})}>
              Retry save
            </button>{" "}
            <button className="button" onClick={downloadDraft}>
              Download my edits
            </button>{" "}
            <button
              className="button"
              onClick={() => {
                if (discardConfirm) reset();
                else setDiscardConfirm(true);
              }}
            >
              {discardConfirm ? "Discard my edits and reload saved draft" : "Reload saved draft"}
            </button>
          </div>
        )}
        {api.checkFreshness && (
          <div className="banner">
            {freshnessError
              ? `Could not check GitHub: ${freshnessError}`
              : freshness
                ? `GitHub PR is ${freshness.state}. Checked ${new Date(freshness.checkedAt).toLocaleTimeString()}.`
                : "Checking GitHub for new commits…"}{" "}
            <button className="button button--quiet" onClick={checkFreshness}>
              Check GitHub
            </button>
          </div>
        )}
        {problems.length > 0 && (
          <div className="banner banner--error">
            <strong>
              The tour has problems. The agent should fix these and run validate again.
            </strong>
            <ul>
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        )}
        {!isAuthor && (
          <div className="banner">
            {meta.author.login}’s agent wrote this tour, so only they can post its findings. Your
            own line comments, summary, and decision post as you.
          </div>
        )}
        {!isLatest && (
          <div className="banner">
            You are reading r{current.revision}, an earlier revision
            {reading ? "." : ", so it is read-only."}{" "}
            <button
              type="button"
              className="button button--quiet"
              onClick={() => onNavigate({ tourId: revisionRef.tourId, revision: latest.revision })}
            >
              Go to r{latest.revision}
            </button>
            .
          </div>
        )}
        {outdated && reading && (
          <div className="banner">
            The PR had moved on to <code>{liveHeadSha.slice(0, 7)}</code> before this export, but r
            {current.revision} reviews <code>{current.headSha.slice(0, 7)}</code>.
          </div>
        )}
        {outdated && !reading && (
          <div className="banner banner--error">
            The PR has new commits: it is at <code>{liveHeadSha.slice(0, 7)}</code>, but r
            {current.revision} reviews <code>{current.headSha.slice(0, 7)}</code>.{" "}
            {isAuthor ? (
              <>
                Update the tour to review the new commits.
                <p>
                  In your thread, run <code>/pr-tour {pr.url}</code> to update this tour.
                </p>
              </>
            ) : (
              `Ask ${meta.author.login} to revise the tour.`
            )}
          </div>
        )}
        {isLatest && draft.readyAt && !draft.synced && (
          <div className="banner">
            This review is marked ready to sync. Choose “Keep editing” to make changes.
          </div>
        )}

        <section className="panel">
          <h2>Summary</h2>
          {tour ? <Markdown>{tour.summary}</Markdown> : <p>No tour yet.</p>}
          {pr.body.trim() && (
            <details className="pr-body">
              <summary>PR description</summary>
              <Markdown>{pr.body}</Markdown>
            </details>
          )}
        </section>

        {since && revisionView && (
          <SinceRevision since={since} previous={revisionView.previous} history={history} />
        )}

        <Unexplained hunks={unexplained} />

        {tour && <Requirements tour={tour} />}

        {sections.map((section) => (
          <Section
            key={section.id}
            section={section}
            sectionTitles={sectionTitles}
            draft={draft}
            dispatch={dispatch}
            readOnly={readOnly}
            findingsReadOnly={findingsReadOnly}
            viewedReadOnly={viewedReadOnly}
            history={history}
            revisionView={revisionView}
          />
        ))}

        {!reading && (
          <FinishReview
            tour={tour}
            draft={draft}
            dispatch={dispatch}
            isAuthor={isAuthor}
            isLatest={isLatest}
            posted={posted}
            syncCommand={review.syncCommand}
            revisionRef={revisionRef}
            onPosted={reset}
          />
        )}
      </main>
    </div>
  );
}
