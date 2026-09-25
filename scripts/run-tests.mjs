import { readdirSync } from 'node:fs';
import { createServer } from 'vite';

const testFiles = readdirSync(new URL('../src/test', import.meta.url))
  .filter((name) => name.endsWith('.test.ts'))
  .sort();

const server = await createServer({
  server: { middlewareMode: true },
  logLevel: 'silent',
  configFile: false
});

try {
  for (const file of testFiles) {
    await server.ssrLoadModule(`/src/test/${file}`);
  }

  const tests = globalThis.__marbleTests ?? [];
  let passed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      passed++;
      console.log(`✓ ${name}`);
    } catch (error) {
      console.error(`✗ ${name}`);
      console.error(`  ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }

  console.log(`\n${passed}/${tests.length} 个离线测试通过`);
} finally {
  await server.close();
}
