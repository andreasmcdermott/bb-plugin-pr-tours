import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { DraftSchema, PrMetaSchema } from "./shared/schema.ts";
import {
  ReviewResponseSchema,
  RevisionRefSchema,
  StaticDataSchema,
  ToursResponseSchema,
} from "./shared/wire.ts";

import {
  DraftStateSchema,
  FreshnessSchema,
  PreviewSchema,
  ProgressSchema,
  SnapshotSchema,
} from "./shared/plugin-contract.ts";

const dir = z.string().min(1);
export const hostContract = defineRpcContract({
  prepare: {
    input: z.object({ ref: z.string().min(1), dir: dir.optional() }),
    output: z.object({ dir, pr: PrMetaSchema, warnings: z.array(z.string()) }),
  },
  import: { input: z.object({ dir }), output: z.object({ dir, pr: PrMetaSchema }) },
  tours: { input: z.object({ dir }), output: ToursResponseSchema },
  review: { input: z.object({ dir, ref: RevisionRefSchema }), output: ReviewResponseSchema },
  draft: { input: z.object({ dir, ref: RevisionRefSchema }), output: DraftStateSchema },
  save: {
    input: z.object({
      dir,
      ref: RevisionRefSchema,
      draft: DraftSchema,
      viewerId: z.number().int().positive(),
      expectedVersion: z.string(),
    }),
    output: DraftStateSchema,
  },
  export: {
    input: z.object({ dir, tourId: z.string() }).strict(),
    output: StaticDataSchema,
  },
  freshness: { input: z.object({ dir }), output: FreshnessSchema },
  progress: { input: z.object({ dir }), output: ProgressSchema },
  preview: {
    input: z.object({ dir, ref: RevisionRefSchema, viewerId: z.number().int().positive() }),
    output: PreviewSchema,
  },
  post: {
    input: z.object({
      dir,
      ref: RevisionRefSchema,
      viewerId: z.number().int().positive(),
      token: z.string(),
    }),
    output: z.object({ url: z.string(), warnings: z.array(z.string()) }),
  },
  snapshot: {
    input: z.object({ dir, kind: z.enum(["review", "export"]), ref: RevisionRefSchema }),
    output: SnapshotSchema,
  },
  chunk: {
    input: z.object({ token: z.string().uuid(), index: z.number().int().nonnegative() }),
    output: z.string(),
  },
  release: { input: z.object({ token: z.string().uuid() }), output: z.null() },
  command: {
    input: z.object({
      dir,
      action: z.enum(["new-tour", "write-tour", "revise", "validate", "sync"]),
      tour: z.string().optional(),
      model: z.string().optional(),
      agent: z.string().optional(),
      file: z.string().optional(),
      dryRun: z.boolean().optional(),
    }),
    output: z.object({ text: z.string(), valid: z.boolean() }),
  },
});
