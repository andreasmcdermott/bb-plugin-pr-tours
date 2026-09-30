for (const command of [
  ["node", "scripts/build-export.mjs"],
  ["bb", "plugin", "build"],
]) {
  const result = Bun.spawnSync(command, { stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) process.exit(result.exitCode);
}
