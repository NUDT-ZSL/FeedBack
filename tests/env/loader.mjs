// Resolve 'three'/'howler' to local stubs and extensionless relative TS imports.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const envDir = path.dirname(fileURLToPath(import.meta.url));
const stubMap = {
  three: pathToFileURL(path.join(envDir, 'stubs', 'three.mjs')).href,
  howler: pathToFileURL(path.join(envDir, 'stubs', 'howler.mjs')).href,
};

export async function resolve(specifier, context, nextResolve) {
  if (stubMap[specifier]) {
    return { url: stubMap[specifier], shortCircuit: true };
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !path.extname(specifier)) {
    try {
      return await nextResolve(specifier + '.ts', context);
    } catch {
      return nextResolve(specifier, context);
    }
  }
  return nextResolve(specifier, context);
}
