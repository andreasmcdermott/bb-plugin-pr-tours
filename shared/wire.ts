import { z } from "zod";
import {
  ChangesSchema,
  DraftSchema,
  GitHubUserSchema,
  PrMetaSchema,
  RevisionMetaSchema,
  TourMetaSchema,
  TourSchema,
} from "./schema.ts";

export const DiffFileSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  status: z.enum(["added", "deleted", "modified", "renamed"]),
  binary: z.boolean(),
  hunks: z.array(
    z.object({
      id: z.string(),
      header: z.string(),
      oldStart: z.number(),
      oldLines: z.number(),
      newStart: z.number(),
      newLines: z.number(),
      lines: z.array(
        z.object({
          kind: z.enum(["context", "add", "del"]),
          oldLine: z.number().nullable(),
          newLine: z.number().nullable(),
          text: z.string(),
          noNewlineAtEnd: z.boolean().optional(),
        }),
      ),
    }),
  ),
});
export const ValidationSchema = z.object({
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  uncovered: z.array(z.string()),
});
export const ToursResponseSchema = z.object({
  viewer: GitHubUserSchema,
  tours: z.array(
    z.object({
      id: z.string(),
      meta: TourMetaSchema,
      status: z.enum(["missing", "invalid", "ok"]),
      revision: z.number(),
      headSha: z.string(),
      findings: z.number(),
    }),
  ),
});
export const ReviewResponseSchema = z.object({
  dir: z.string(),
  syncCommand: z.string(),
  reviseCommand: z.string(),
  pr: PrMetaSchema,
  liveHeadSha: z.string(),
  files: z.array(DiffFileSchema),
  meta: TourMetaSchema,
  revision: RevisionMetaSchema,
  revisions: z.array(RevisionMetaSchema),
  isLatest: z.boolean(),
  viewer: GitHubUserSchema,
  isAuthor: z.boolean(),
  tour: TourSchema.nullable(),
  tourErrors: z.array(z.string()),
  validation: ValidationSchema.nullable(),
  previous: z.object({ revision: z.number(), tour: TourSchema }).nullable(),
  changes: ChangesSchema.nullable(),
  history: z.record(
    z.string(),
    z.object({
      revision: z.number(),
      status: z.enum(["accepted", "dismissed"]),
      posted: z.boolean(),
      url: z.string().nullable(),
    }),
  ),
  unchangedSections: z.array(z.string()),
});
export const StaticDataSchema = z.object({
  mode: z.literal("read"),
  tours: ToursResponseSchema,
  reviews: z.record(z.string(), ReviewResponseSchema),
  drafts: z.record(z.string(), DraftSchema),
});
export const RevisionRefSchema = z.object({
  tourId: z.string().min(1),
  revision: z.number().int().positive(),
});
export const LibraryEntrySchema = z.object({
  id: z.string(),
  hostId: z.string(),
  dir: z.string(),
  threadId: z.string().nullable(),
  title: z.string(),
  url: z.string(),
  updatedAt: z.string(),
  archived: z.coerce.boolean().default(false),
});
export type LibraryEntry = z.infer<typeof LibraryEntrySchema>;
