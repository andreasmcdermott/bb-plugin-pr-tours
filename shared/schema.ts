import { z } from "zod";

export const PrMetaSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
  url: z.string(),
  title: z.string(),
  body: z.string(),
  author: z.string(),
  baseRef: z.string(),
  headRef: z.string(),
  mergeBaseSha: z.string(),
  headSha: z.string(),
  preparedAt: z.string(),
});
export type PrMeta = z.infer<typeof PrMetaSchema>;

const SideSchema = z.enum(["LEFT", "RIGHT"]);

export const AnchorSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive().optional(),
  startLine: z.number().int().positive().optional(),
  side: SideSchema.default("RIGHT"),
});
export type Anchor = z.infer<typeof AnchorSchema>;

export const RangeNoteSchema = z.object({
  startLine: z.number().int().positive().optional(),
  line: z.number().int().positive(),
  side: SideSchema.default("RIGHT"),
  note: z.string(),
});
export type RangeNote = z.infer<typeof RangeNoteSchema>;

export const SEVERITIES = ["blocker", "major", "minor", "nit", "question"] as const;

export const FindingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(SEVERITIES),
  title: z.string().min(1),
  body: z.string(),
  anchor: AnchorSchema,
  suggestion: z.string().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const WhySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("requirement"), requirements: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal("supporting"), supports: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal("mechanical") }),
  z.object({ kind: z.literal("unexplained") }),
]);
export type Why = z.infer<typeof WhySchema>;

export const FollowUpSchema = z.object({
  finding: z.string().min(1),
  status: z.enum(["resolved", "outdated"]),
  note: z.string(),
  refs: z.array(z.string()).default([]),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;

export const TourSchema = z.object({
  version: z.literal(1),
  headSha: z.string(),
  summary: z.string(),
  stories: z
    .array(z.object({ id: z.string(), title: z.string(), url: z.string().optional() }))
    .default([]),
  requirements: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string(),
        status: z.enum(["met", "partial", "unmet", "unclear"]),
        notes: z.string().optional(),
      }),
    )
    .default([]),
  sections: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        narrative: z.string(),
        hunks: z.array(
          z.object({
            ref: z.string(),
            note: z.string(),
            why: WhySchema,
            ranges: z.array(RangeNoteSchema).default([]),
          }),
        ),
        findings: z.array(FindingSchema).default([]),
      }),
    )
    .min(1),
  followUp: z.array(FollowUpSchema).default([]),
});
export type Tour = z.infer<typeof TourSchema>;
export type TourSection = Tour["sections"][number];

export const GitHubUserSchema = z.object({ login: z.string(), id: z.number().int() });
export type GitHubUser = z.infer<typeof GitHubUserSchema>;

export const TOUR_ID = /^[a-z0-9][a-z0-9.-]*$/;

export const TourMetaSchema = z.object({
  id: z.string().regex(TOUR_ID),
  author: GitHubUserSchema,
  model: z.string().min(1),
  agent: z.string().min(1).optional(),
  createdAt: z.string(),
});
export type TourMeta = z.infer<typeof TourMetaSchema>;

export const RevisionMetaSchema = z.object({
  revision: z.number().int().positive(),
  headSha: z.string(),
  model: z.string().min(1),
  agent: z.string().min(1).optional(),
  createdAt: z.string(),
});
export type RevisionMeta = z.infer<typeof RevisionMetaSchema>;

export const ChangesSchema = z.object({
  from: z.object({ revision: z.number().int().positive(), headSha: z.string() }),
  to: z.object({ revision: z.number().int().positive(), headSha: z.string() }),
  carried: z.array(z.object({ ref: z.string(), previous: z.string() })),
  changed: z.array(z.string()),
  dropped: z.array(z.string()),
});
export type Changes = z.infer<typeof ChangesSchema>;

export const REVIEW_EVENTS = ["COMMENT", "APPROVE", "REQUEST_CHANGES"] as const;
export type ReviewEvent = (typeof REVIEW_EVENTS)[number];

export const ReviewerCommentSchema = z.object({
  id: z.string(),
  path: z.string(),
  side: SideSchema,
  line: z.number().int().positive(),
  body: z.string(),
});
export type ReviewerComment = z.infer<typeof ReviewerCommentSchema>;

export const DraftSchema = z.object({
  headSha: z.string(),
  findings: z.record(
    z.string(),
    z.object({ status: z.enum(["accepted", "dismissed"]), body: z.string().optional() }),
  ),
  comments: z.array(ReviewerCommentSchema),
  viewedSections: z.array(z.string()),
  body: z.string(),
  event: z.enum(REVIEW_EVENTS).nullable(),
  readyAt: z.string().nullable(),
  synced: z
    .object({
      at: z.string(),
      url: z.string(),
      reviewId: z.number().int().optional(),
      comments: z
        .array(z.object({ source: z.string(), githubId: z.number().int(), url: z.string() }))
        .optional(),
    })
    .nullable(),
});
export type Draft = z.infer<typeof DraftSchema>;

export function emptyDraft(headSha: string): Draft {
  return {
    headSha,
    findings: {},
    comments: [],
    viewedSections: [],
    body: "",
    event: null,
    readyAt: null,
    synced: null,
  };
}

export function formatZodError(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}
