import { z } from "zod";
import { DraftSchema, GitHubUserSchema } from "./schema.ts";

export const DraftStateSchema = z.object({ draft: DraftSchema, version: z.string() });
export const FreshnessSchema = z.object({
  headSha: z.string(),
  state: z.string(),
  checkedAt: z.string(),
});
export const ReviewPayloadSchema = z.object({
  commit_id: z.string(),
  body: z.string(),
  event: z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
  comments: z.array(
    z.object({
      path: z.string(),
      body: z.string(),
      line: z.number(),
      side: z.enum(["LEFT", "RIGHT"]),
      start_line: z.number().optional(),
      start_side: z.enum(["LEFT", "RIGHT"]).optional(),
    }),
  ),
});
export const PreviewSchema = z.object({
  token: z.string(),
  viewer: GitHubUserSchema,
  payload: ReviewPayloadSchema,
});
export type ReviewPreview = z.infer<typeof PreviewSchema>;
export const ProgressSchema = z.object({
  status: z.enum(["not-started", "in-progress", "ready", "posted"]),
  viewed: z.number(),
  total: z.number(),
});
export const SnapshotSchema = z.object({ token: z.string(), chunks: z.number().int().positive() });
