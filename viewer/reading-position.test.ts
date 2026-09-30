import { describe, expect, test } from "bun:test";
import { currentTarget } from "./reading-position.ts";

const targets = (...tops: number[]) => tops.map((top, i) => ({ id: `t${i}`, top }));

describe("currentTarget", () => {
  test("is the last target that has reached the reading line", () => {
    expect(currentTarget(targets(-900, -40, 60, 700), { line: 80, atBottom: false })).toBe("t2");
    expect(currentTarget(targets(-900, -40, 81, 700), { line: 80, atBottom: false })).toBe("t1");
  });

  test("is the first target before any has reached the line", () => {
    expect(currentTarget(targets(120, 700), { line: 80, atBottom: false })).toBe("t0");
  });

  test("is the last target once the page can't scroll further", () => {
    expect(currentTarget(targets(-900, 300, 700), { line: 80, atBottom: true })).toBe("t2");
  });

  test("is nothing without targets", () => {
    expect(currentTarget([], { line: 80, atBottom: false })).toBeNull();
  });
});
