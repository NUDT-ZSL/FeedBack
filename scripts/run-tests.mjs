import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const typescript = require('typescript');
const projectRoot = process.cwd();
const outputRoot = await mkdtemp(join(tmpdir(), 'smart-wordbook-tests-'));

try {
  const transpile = async (relativeSourcePath, relativeOutputPath) => {
    const sourcePath = join(projectRoot, relativeSourcePath);
    const outputPath = join(outputRoot, relativeOutputPath);
    const source = await readFile(sourcePath, 'utf8');
    const { outputText } = typescript.transpileModule(source, {
      compilerOptions: {
        target: typescript.ScriptTarget.ES2020,
        module: typescript.ModuleKind.CommonJS,
      },
    });

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, outputText, 'utf8');
  };

  await transpile('src/utils/urgency.ts', join('src', 'utils', 'urgency.js'));
  await transpile('src/tests/urgency.test.ts', join('src', 'tests', 'urgency.test.js'));

  const testEntry = join(outputRoot, 'src', 'tests', 'urgency.test.js');
  const result = spawnSync(process.execPath, [testEntry], {
    cwd: outputRoot,
    stdio: 'inherit',
  });

  process.exitCode = result.status ?? 1;
} finally {
  await rm(outputRoot, { recursive: true, force: true });
}
