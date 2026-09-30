import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { DraftSchema, PrMetaSchema } from "./shared/schema.ts";
import {
  ReviewResponseSchema,
  RevisionRefSchema,
  StaticDataSchema,
  ToursResponseSchema,
} from "./shared/wire.ts";

const dir = z.string().min(1);
export const hostContract = defineRpcContract({
  prepare: {
    input: z.object({ ref: z.string().min(1), dir: dir.optional() }),
    output: z.object({ dir, pr: PrMetaSchema, warnings: z.array(z.string()) }),
  },
  import: { input: z.object({ dir }), output: z.object({ dir, pr: PrMetaSchema }) },
  tours: { input: z.object({ dir }), output: ToursResponseSchema },
  review: { input: z.object({ dir, ref: RevisionRefSchema }), output: ReviewResponseSchema },
  draft: { input: z.object({ dir, ref: RevisionRefSchema }), output: DraftSchema },
  save: {
    input: z.object({
      dir,
      ref: RevisionRefSchema,
      draft: DraftSchema,
      viewerId: z.number().int().positive(),
    }),
    output: DraftSchema,
  },
  export: {
    input: z.object({ dir, tourId: z.string() }).strict(),
    output: StaticDataSchema,
  },
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
