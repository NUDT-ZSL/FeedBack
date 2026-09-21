const http = require("node:http");
const { extname, join, normalize } = require("node:path");
const { createReadStream, existsSync, statSync } = require("node:fs");

const root = join(__dirname, "..");
const port = Number(process.env.PORT || 4173);
const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"]
]);

http.createServer((request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, requested);
  if (!file.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": types.get(extname(file)) || "application/octet-stream" });
  createReadStream(file).pipe(response);
}).listen(port, () => {
  console.log(`评分工作台已启动：http://localhost:${port}`);
});
