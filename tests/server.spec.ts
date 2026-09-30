import ts from "typescript";
import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { createFakePluginHost, experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";
import { fixturePr, tourAuthor } from "../shared/fixtures.ts";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((fn) => fn()));
});
function setup() {
  const fake = createFakePluginHost({
    pluginId: "pr-tours",
    experimental_hostEntry: true,
    sdk: {
      threads: {
        storageLocation: async () => ({
          hostId: "agent-machine",
          storageRootPath: "/threads/current",
        }),
      },
      system: { config: async () => ({ primaryHostId: "local-machine" }) as never },
    },
    experimental_callHostRpc: async ({ method }) => {
      if (method === "prepare" || method === "import")
        return {
          dir: "/plugin/reviews/org-repo-1",
          pr: fixturePr,
          ...(method === "prepare" ? { warnings: [] } : {}),
        };
      if (method === "tours") return { viewer: tourAuthor, tours: [] };
      if (method === "command") return { valid: true, text: "validated" };
      if (method === "export")
        return {
          mode: "read",
          tours: { viewer: tourAuthor, tours: [] },
          reviews: {},
          drafts: {},
        };
      throw new Error(`Unexpected ${method}`);
    },
  });
  disposers.push(() => fake.harness.lifecycle.dispose());
  plugin(fake.bb);
  return fake;
}
it("registers on the agent host and associates a review with multiple threads", async () => {
  const { harness } = setup();
  const prepared = await harness.behavior.runCli(["prepare", "org/repo#1"], {
    threadId: "thread-a",
  });
  expect(prepared.exitCode).toBe(0);
  const entry = JSON.parse(prepared.stdout!);
  expect(entry.hostId).toBe("agent-machine");
  expect(harness.experimental_hostRpcCalls[0].hostId).toBe("agent-machine");
  const second = await harness.behavior.runCli(["prepare", "org/repo#1"], { threadId: "thread-b" });
  expect(JSON.parse(second.stdout!).id).toBe(entry.id);
  for (const threadId of ["thread-a", "thread-b"])
    expect(await harness.behavior.callRpc("list", { threadId })).toHaveLength(1);
  expect(await harness.behavior.callRpc("list", { threadId: "unrelated" })).toEqual([]);
  expect(await harness.behavior.callRpc("list", {})).toHaveLength(1);
  const reloaded = await harness.lifecycle.reload(plugin);
  disposers.push(() => reloaded.harness.lifecycle.dispose());
  expect(await reloaded.harness.behavior.callRpc("list", {})).toHaveLength(1);
});
it("rejects unknown library IDs and malformed revision requests before host access", async () => {
  const { harness } = setup();
  await expect(harness.behavior.callRpc("tours", { id: "../elsewhere" })).rejects.toThrow(
    "Unknown review",
  );
  await expect(
    harness.behavior.callRpc("review", { id: "x", ref: { tourId: "x", revision: -1 } }),
  ).rejects.toThrow();
  expect(harness.experimental_hostRpcCalls).toHaveLength(0);
});
it("uses only public BB SDK imports", () => {
  const result = experimental_scanPublicSdkOnly(process.cwd(), {
    allow: [
      /^react$/,
      /^react-dom\//,
      /^react-markdown$/,
      /^remark-gfm$/,
      /^shiki\//,
      /^bun:test$/,
      /^vitest(?:\/config)?$/,
      /^@testing-library\/react$/,
      /^esbuild$/,
      /^typescript$/,
      /^@get-bb\/plugin-sdk\/testing(?:\/app|\/host)?$/,
    ],
  });
  // SDK 0.5.9 scans with regex and mistakes grammar strings and methods named
  // "import" for imports. Restrict its findings to actual AST import edges.
  const actualImports = new Map(
    result.files.map((file) => {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const imports = new Set<string>();
      const visit = (node: ts.Node) => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        )
          imports.add(node.moduleSpecifier.text);
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const arg = node.arguments[0];
          if (!arg || !ts.isStringLiteral(arg))
            throw new Error(`Nonliteral dynamic import in ${file}`);
          imports.add(arg.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      return [file, imports] as const;
    }),
  );
  expect(
    result.violations.filter((item) => actualImports.get(item.file)?.has(item.specifier)),
  ).toEqual([]);
  expect(result.privateDependencies).toEqual([]);
});
