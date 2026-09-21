import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT || 4173);

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"]
]);

const server = createServer((request, res) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = normalize(join(root, pathname));

  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("未找到资源");
    return;
  }

  res.writeHead(200, { "Content-Type": types.get(extname(file)) || "application/octet-stream" });
  createReadStream(file).pipe(res);
});

server.listen(port, () => {
  console.log(`活动上下文恢复工作台：http://localhost:${port}`);
});
