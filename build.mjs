import { readFile, writeFile, mkdir } from "node:fs/promises";

const [coreSource, appSource, htmlSource, styleSource] = await Promise.all([
  readFile("core.js", "utf8"),
  readFile("app.js", "utf8"),
  readFile("index.html", "utf8"),
  readFile("styles.css", "utf8")
]);

const classicCore = coreSource.replace(/^export\s+/gm, "");
const classicApp = appSource
  .replace(/^import\s+\{\s*findRelated,\s*normalizeText,\s*parseTags\s*\}\s+from\s+"\.\/core\.js";\s*$/m, "")
  .replace(/^export\s+/gm, "");
const output = htmlSource.replace(
  '  <link rel="stylesheet" href="styles.css">',
  `  <style>\n${styleSource}\n  </style>`
).replace(
  '<script type="module" src="app.js"></script>',
  `<script>\n${classicCore}\n${classicApp}\n</script>`
);

await mkdir("dist", { recursive: true });
await writeFile("dist/index.html", output, "utf8");
console.log("dist/index.html written");
