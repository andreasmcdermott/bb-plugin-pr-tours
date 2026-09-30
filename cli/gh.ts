import { spawn } from "node:child_process";
import { GitHubUserSchema, type GitHubUser } from "../shared/schema.ts";

export type Gh = (args: string[], input?: string) => Promise<string>;

export const gh: Gh = (args, input) =>
  new Promise((resolve, reject) => {
    const proc = spawn("gh", args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("GitHub request timed out"));
    }, 120_000);
    proc.stdout.on("data", (chunk) => stdout.push(chunk));
    proc.stderr.on("data", (chunk) => stderr.push(chunk));
    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString();
      if (code !== 0)
        reject(
          new Error(
            `gh ${args.join(" ")} failed: ${Buffer.concat(stderr).toString().trim() || out.trim()}`,
          ),
        );
      else resolve(out);
    });
    proc.stdin.on("error", () => {});
    proc.stdin.end(input);
  });

export async function ghJson<T>(run: Gh, args: string[], input?: string): Promise<T> {
  return JSON.parse(await run(args, input)) as T;
}

export async function currentUser(run: Gh): Promise<GitHubUser> {
  return GitHubUserSchema.parse(await ghJson(run, ["api", "user"]));
}
