'use strict';
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const ids = new Set(Array.from(html.matchAll(/id="([^"]+)"/g)).map(m => m[1]));
const js = ['js/main.js', 'js/ui-map.js', 'js/ui-panels.js', 'js/ui-object.js']
  .map(f => fs.readFileSync(f, 'utf8')).join('\n');
const used = Array.from(js.matchAll(/getElementById\('([^']+)'\)/g)).map(m => m[1]);
const dynamic = new Set(['qe-cx', 'qe-cy', 'qe-r', 'qe-minx', 'qe-maxx', 'qe-miny', 'qe-maxy',
  'qe-cats', 'qe-asof', 'cf-source', 'cf-x', 'cf-y', 'cf-category', 'cf-from', 'cf-to']);
const missing = used.filter(u => !ids.has(u) && !dynamic.has(u) && !u.startsWith('adj-'));
console.log('html ids:', Array.from(ids).join(','));
console.log('missing in html:', missing.length ? missing.join(',') : '(none)');
if (missing.length) process.exit(1);
