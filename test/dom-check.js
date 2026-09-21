/* 静态检查：ui.js 引用的 DOM id 是否存在于 index.html，脚本文件是否存在 */
const fs = require("fs");
const html = fs.readFileSync("index.html", "utf8");
const ui = fs.readFileSync("js/ui.js", "utf8");
const ids = [...ui.matchAll(/getElementById\("([^"]+)"\)/g)].map(m => m[1]);
const dynamic = new Set(["change-log"]); // 详情渲染时动态创建
let bad = 0;
for (const id of new Set(ids)) {
  if (!html.includes('id="' + id + '"') && !dynamic.has(id)) {
    console.log("MISSING #" + id); bad++;
  }
}
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const p = m[1];
  if (!p.startsWith("http") && !fs.existsSync(p)) { console.log("MISSING FILE " + p); bad++; }
}
console.log(bad ? bad + " 处问题" : "DOM id 与资源引用全部匹配");
process.exit(bad ? 1 : 0);
