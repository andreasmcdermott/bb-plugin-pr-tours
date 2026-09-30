import type { DiffFile } from "../shared/diff.ts";
import type { FindingHistory } from "../shared/review.ts";
import {
  DraftSchema,
  type Changes,
  type Draft,
  type GitHubUser,
  type PrMeta,
  type RevisionMeta,
  type Tour,
  type TourMeta,
} from "../shared/schema.ts";
import type { Validation } from "../shared/validate.ts";

export type ReviewResponse = {
  dir: string;
  syncCommand: string;
  reviseCommand: string;
  pr: PrMeta;
  liveHeadSha: string;
  files: DiffFile[];
  meta: TourMeta;
  revision: RevisionMeta;
  revisions: RevisionMeta[];
  isLatest: boolean;
  viewer: GitHubUser;
  isAuthor: boolean;
  tour: Tour | null;
  tourErrors: string[];
  validation: Validation | null;
  previous: { revision: number; tour: Tour } | null;
  changes: Changes | null;
  history: Record<string, FindingHistory>;
  unchangedSections: string[];
};

export type TourSummary = {
  id: string;
  meta: TourMeta;
  status: "missing" | "invalid" | "ok";
  revision: number;
  headSha: string;
  findings: number;
};

export type ToursResponse = { viewer: GitHubUser; tours: TourSummary[] };

export type RevisionRef = { tourId: string; revision: number };

export type StaticData = {
  mode: "read";
  tours: ToursResponse;
  reviews: Record<string, ReviewResponse>;
  drafts: Record<string, Draft>;
};

export const STATIC_DATA_ID = "pr-tour-data";

export const revisionKey = ({ tourId, revision }: RevisionRef) => `${tourId}@${revision}`;

function readStaticData(): StaticData | null {
  if (typeof document === "undefined") return null;
  const text = document.getElementById(STATIC_DATA_ID)?.textContent;
  return text ? (JSON.parse(text) as StaticData) : null;
}

const staticData = readStaticData();
export const isStatic = staticData !== null;

const storagePrefix = () => `pr-tour:${window.location.pathname}:`;

function fromStatic<T>(data: Record<string, T>, ref: RevisionRef): Promise<T> {
  const value = data[revisionKey(ref)];
  if (value === undefined) {
    return Promise.reject(
      new Error(`r${ref.revision} of tour ${ref.tourId} is not in this export`),
    );
  }
  return Promise.resolve(value);
}

function staticDraft(data: StaticData, ref: RevisionRef): Promise<Draft> {
  const stored = window.localStorage.getItem(storagePrefix() + revisionKey(ref));
  const parsed = stored === null ? null : DraftSchema.safeParse(JSON.parse(stored));
  const exported = data.drafts[revisionKey(ref)];
  if (parsed?.success && parsed.data.headSha === exported?.headSha) {
    return Promise.resolve(parsed.data);
  }
  return fromStatic(data.drafts, ref);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json()) as T & { errors?: string[] };
  if (!response.ok)
    throw new Error(body.errors?.join("\n") ?? `${url} failed with ${response.status}`);
  return body;
}

const withRevision = (url: string, { tourId, revision }: RevisionRef) =>
  `${url}?tour=${encodeURIComponent(tourId)}&rev=${revision}`;

export const fetchTours = () =>
  staticData ? Promise.resolve(staticData.tours) : request<ToursResponse>("/api/tours");

export const fetchReview = (ref: RevisionRef) =>
  staticData
    ? fromStatic(staticData.reviews, ref)
    : request<ReviewResponse>(withRevision("/api/review", ref));

export const fetchDraft = (ref: RevisionRef) =>
  staticData ? staticDraft(staticData, ref) : request<Draft>(withRevision("/api/draft", ref));

export function saveDraft(ref: RevisionRef, draft: Draft): Promise<Draft> {
  if (staticData) {
    window.localStorage.setItem(storagePrefix() + revisionKey(ref), JSON.stringify(draft));
    return Promise.resolve(draft);
  }
  return request<Draft>(withRevision("/api/draft", ref), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
}
