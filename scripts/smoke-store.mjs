import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(root, "node_modules", ".tmp", "smoke-dist.cjs");
await build({
  entryPoints: [join(root, "scripts", "smoke-store-entry.ts")],
  bundle: true, platform: "node", format: "cjs", outfile, logLevel: "silent",
  alias: { "@": join(root, "src") },
});
const r = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
process.exit(r.status ?? 1);
