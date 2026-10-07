// Offline verification entry: installs stubs, collects suites, reports pass/fail.
import { register } from 'node:module';

register('./env/loader.mjs', import.meta.url);

await import('./env/dom.mjs');
const { run } = await import('./harness.mjs');

console.log('云锦织机状态链路离线验证');
console.log('========================');

await import('./loom.test.ts');
await import('./pattern.test.ts');
await import('./scroll.test.ts');
await import('./boundary.test.ts');

await run();
