import type { Gh } from "./gh.ts";

export type FakeGh = Gh & { calls: { args: string[]; input?: string }[] };

// Answers `gh` invocations from a table keyed by the joined argument list.
export function fakeGh(responses: Record<string, string | (() => string)>): FakeGh {
  const calls: FakeGh["calls"] = [];
  const run = async (args: string[], input?: string) => {
    calls.push({ args, input });
    const key = args.join(" ");
    const response = responses[key];
    if (response === undefined) throw new Error(`unexpected gh call: ${key}`);
    return typeof response === "function" ? response() : response;
  };
  return Object.assign(run, { calls });
}
