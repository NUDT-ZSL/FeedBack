const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 8080);
const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);

http.createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const relativePath = requested === "/" ? "/index.html" : requested;
  const filePath = path.normalize(path.join(root, relativePath));
  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": types.get(path.extname(filePath)) || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`离线交接推演已启动：http://127.0.0.1:${port}`);
});
