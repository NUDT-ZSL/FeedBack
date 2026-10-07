import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const assets = join(dist, 'assets');

const inlineHtml = (file) => {
  let html = readFileSync(join(dist, file), 'utf8');

  html = html.replace(
    /<link[^>]*rel="stylesheet"[^>]*href="\.\/assets\/([^"]+)"[^>]*>/g,
    (_, name) => {
      const css = readFileSync(join(assets, name), 'utf8');
      return `<style>\n${css}\n</style>`;
    }
  );

  html = html.replace(
    /<script([^>]*)src="\.\/assets\/([^"]+)"[^>]*><\/script>/g,
    (_, attrs, name) => {
      const js = readFileSync(join(assets, name), 'utf8');
      return `<script type="module">\n${js}\n</script>`;
    }
  );

  writeFileSync(join(dist, file), html, 'utf8');
  console.log(`inlined ${file}`);
};

inlineHtml('index.html');
inlineHtml('batch.html');
