#!/usr/bin/env node
/** 统一批量入口：esbuild 打包引擎 + 用例，离线运行。 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "node_modules", ".tmp");
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, "batch-dist.cjs");

await build({
  entryPoints: [join(root, "scripts", "batch-entry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile,
  logLevel: "silent",
});

const args = process.argv.slice(2);
const caseArgs =
  args.length > 0
    ? args
    : [join(root, "cases", "samples.json")];
const r = spawnSync(process.execPath, [outfile, ...caseArgs], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
