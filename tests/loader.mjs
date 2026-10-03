// ESM resolve hooks for the offline test harness:
//  1. Redirect the bare specifier "phaser" to the local test double so the
//     production TradeManager runs in Node without a browser or node_modules.
//  2. Resolve extensionless relative imports to ".ts" files, matching the
//     bundler-style resolution used by the production sources.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'phaser') {
    return { url: new URL('./phaser-shim.mjs', import.meta.url).href, shortCircuit: true };
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
    try {
      const url = new URL(specifier, context.parentURL);
      const tsPath = fileURLToPath(url) + '.ts';
      if (existsSync(tsPath)) {
        return { url: url.href + '.ts', shortCircuit: true };
      }
    } catch {
      // fall through to default resolution
    }
  }
  return nextResolve(specifier, context);
}
