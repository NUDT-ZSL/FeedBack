import { build } from 'esbuild';

const result = await build({
  entryPoints: ['verify/energy-verify.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
});

const code = result.outputFiles[0].text;
await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
