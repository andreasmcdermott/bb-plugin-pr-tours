import { createContext, useContext, type RefObject } from "react";
import * as local from "./api.ts";
import type { Draft } from "../shared/schema.ts";
export type TourApi = {
  previewReview?: (
    ref: local.RevisionRef,
  ) => Promise<import("../shared/plugin-contract.ts").ReviewPreview>;
  postReview?: (
    ref: local.RevisionRef,
    token: string,
  ) => Promise<{ url: string; warnings: string[] }>;
  checkFreshness?: () => Promise<{ headSha: string; state: string; checkedAt: string }>;
  flush?: () => Promise<void>;
  registerFlush?: (flush: () => Promise<void>) => () => void;
  fetchTours: typeof local.fetchTours;
  fetchReview: typeof local.fetchReview;
  fetchDraft: typeof local.fetchDraft;
  saveDraft: (ref: local.RevisionRef, draft: Draft) => Promise<Draft>;
};
export const TourApiContext = createContext<TourApi>(local);
export const TourRootContext = createContext<RefObject<HTMLDivElement | null> | null>(null);
export const useTourApi = () => useContext(TourApiContext);
