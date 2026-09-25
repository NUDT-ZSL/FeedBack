import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(root, 'entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: path.join(root, 'bundle.mjs'),
  alias: { uuid: path.join(root, 'uuidMock.ts') },
  logLevel: 'info',
});

await import(pathToFileURL(path.join(root, 'bundle.mjs')).href);
