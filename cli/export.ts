import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const VIEWER_ENTRY = path.join(import.meta.dir, "..", "viewer", "index.html");

type ExportOptions = { tour?: string };
export { staticData, embedData } from "./static-data.ts";
import { staticData, embedData } from "./static-data.ts";

function buildViewer(): string {
  const outdir = mkdtempSync(path.join(tmpdir(), "pr-tour-export-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "build",
        "--compile",
        "--target=browser",
        "--minify",
        VIEWER_ENTRY,
        "--outdir",
        outdir,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (result.exitCode !== 0) {
      throw new Error(`building the viewer failed:\n${result.stderr.toString()}`);
    }
    return readFileSync(path.join(outdir, "index.html"), "utf8");
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }
}

export function exportTour(options: ExportOptions & { dir: string; out: string }) {
  const data = staticData(options.dir, options);
  const html = embedData(buildViewer(), data);
  mkdirSync(options.out, { recursive: true });
  const name = `${path.basename(options.dir)}-tour.html`;
  const file = path.join(options.out, name);
  writeFileSync(file, html);
  return { file, bytes: Buffer.byteLength(html), tours: data.tours.tours.length };
}
