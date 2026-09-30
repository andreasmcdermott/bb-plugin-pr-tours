import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parsePrRef, resolveReviewDir, reviewsRoot } from "./review-dir.ts";

describe("parsePrRef", () => {
  test("accepts URLs and owner/repo#number", () => {
    const expected = { owner: "useshortcut", repo: "monorepo", number: 42 };
    expect(parsePrRef("https://github.com/useshortcut/monorepo/pull/42/files")).toEqual(expected);
    expect(parsePrRef("useshortcut/monorepo#42")).toEqual(expected);
    expect(() => parsePrRef("42")).toThrow("expected a PR URL");
  });
});

describe("reviewsRoot", () => {
  test("keeps reviews in ~/pr-tours", () => {
    expect(reviewsRoot({})).toBe(path.join(homedir(), "pr-tours"));
  });

  test("uses PR_TOUR_HOME when it is set", () => {
    expect(reviewsRoot({ PR_TOUR_HOME: "/data/tours" })).toBe("/data/tours");
  });
});

describe("resolveReviewDir", () => {
  const root = "/home/me/pr-tours";
  const cwd = mkdtempSync(path.join(tmpdir(), "pr-tour-cwd-"));

  test("finds a review by its directory name", () => {
    expect(resolveReviewDir("useshortcut-monorepo-42", root, cwd)).toBe(
      path.join(root, "useshortcut-monorepo-42"),
    );
  });

  test("finds a review by its PR", () => {
    const expected = path.join(root, "useshortcut-monorepo-42");
    expect(resolveReviewDir("useshortcut/monorepo#42", root, cwd)).toBe(expected);
    expect(resolveReviewDir("https://github.com/useshortcut/monorepo/pull/42", root, cwd)).toBe(
      expected,
    );
  });

  test("uses a path that exists", () => {
    mkdirSync(path.join(cwd, "reviews", "useshortcut-monorepo-42"), { recursive: true });
    expect(resolveReviewDir("reviews/useshortcut-monorepo-42", root, cwd)).toBe(
      path.join(cwd, "reviews", "useshortcut-monorepo-42"),
    );
    expect(resolveReviewDir(cwd, root, "/")).toBe(cwd);
  });
});
