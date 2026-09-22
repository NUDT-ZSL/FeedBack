const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 5173);
const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"]
]);

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const safePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.normalize(path.join(root, safePath));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("未找到文件");
    }
    res.writeHead(200, {
      "Content-Type": types.get(path.extname(file)) || "application/octet-stream"
    });
    res.end(data);
  });
}).listen(port, () => {
  console.log(`装载规划台已启动: http://localhost:${port}`);
});
