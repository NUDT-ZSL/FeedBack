#!/usr/bin/env node
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "node_modules", ".tmp");
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, "selftest-dist.cjs");

await build({
  entryPoints: [join(root, "scripts", "selftest-entry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile,
  logLevel: "silent",
});
const r = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
process.exit(r.status ?? 1);
