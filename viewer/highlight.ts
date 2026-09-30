import { createHighlighterCoreSync, type HighlighterCore, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import clojure from "shiki/langs/clojure.mjs";
import css from "shiki/langs/css.mjs";
import docker from "shiki/langs/docker.mjs";
import hcl from "shiki/langs/hcl.mjs";
import html from "shiki/langs/html.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import jsx from "shiki/langs/jsx.mjs";
import markdown from "shiki/langs/markdown.mjs";
import python from "shiki/langs/python.mjs";
import shellscript from "shiki/langs/shellscript.mjs";
import sql from "shiki/langs/sql.mjs";
import terraform from "shiki/langs/terraform.mjs";
import toml from "shiki/langs/toml.mjs";
import tsx from "shiki/langs/tsx.mjs";
import typescript from "shiki/langs/typescript.mjs";
import yaml from "shiki/langs/yaml.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";
import type { Hunk } from "../shared/diff.ts";

export type Token = Pick<ThemedToken, "content" | "color" | "fontStyle"> & { darkColor?: string };

const BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  clj: "clojure",
  cljs: "clojure",
  cljc: "clojure",
  edn: "clojure",
  bb: "clojure",
  css: "css",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  tf: "terraform",
  tfvars: "terraform",
  hcl: "hcl",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  sql: "sql",
  html: "html",
  py: "python",
  toml: "toml",
};

export function languageFor(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name === "Dockerfile" || name.endsWith(".Dockerfile")) return "docker";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? (BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null) : null;
}

let highlighter: HighlighterCore | undefined;

function getHighlighter(): HighlighterCore {
  highlighter ??= createHighlighterCoreSync({
    themes: [githubLight, githubDark],
    langs: [
      clojure,
      css,
      docker,
      hcl,
      html,
      javascript,
      json,
      jsx,
      markdown,
      python,
      shellscript,
      sql,
      terraform,
      toml,
      tsx,
      typescript,
      yaml,
    ],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighter;
}

const plain = (lines: string[]): Token[][] => lines.map((content) => [{ content }]);

export function highlightLines(path: string, lines: string[]): Token[][] {
  const lang = languageFor(path);
  if (!lang) return plain(lines);
  const tokens = getHighlighter().codeToTokensWithThemes(lines.join("\n"), {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    tokenizeMaxLineLength: 2000,
  });
  return lines.map(
    (content, index) =>
      tokens[index]?.map((token) => ({
        content: token.content,
        color: token.variants.light!.color,
        darkColor: token.variants.dark!.color,
        fontStyle: token.variants.light!.fontStyle,
      })) ?? [{ content }],
  );
}

// Each side of the hunk is tokenized on its own so that a removed line that
// opens a comment or string does not change how the new code is colored.
export function highlightHunk(path: string, hunk: Hunk): Token[][] {
  const newSide = highlightLines(
    path,
    hunk.lines.filter((line) => line.kind !== "del").map((line) => line.text),
  );
  const oldSide = highlightLines(
    path,
    hunk.lines.filter((line) => line.kind !== "add").map((line) => line.text),
  );
  let newIndex = 0;
  let oldIndex = 0;
  return hunk.lines.map((line) => {
    if (line.kind === "del") return oldSide[oldIndex++]!;
    if (line.kind === "context") oldIndex++;
    return newSide[newIndex++]!;
  });
}
