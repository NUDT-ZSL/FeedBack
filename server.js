'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const root = __dirname;
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon']
]);

function serve(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime.get(path.extname(filePath)) || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const filePath = path.normalize(path.join(root, relative));
  if (!filePath.startsWith(root) || relative.includes('..')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.stat(filePath, (error, stat) => {
    if (!error && stat.isFile()) serve(res, filePath);
    else serve(res, path.join(root, 'index.html'));
  });
});

function listen(port) {
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && port < 5190) listen(port + 1);
    else throw error;
  });
  server.listen(port, '127.0.0.1', () => {
    const target = `http://127.0.0.1:${port}`;
    console.log(`资金情景推演应用已启动：${target}`);
    const command = process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', target]]
      : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
    execFile(command[0], command[1], () => {});
  });
}

listen(Number(process.env.PORT) || 5173);
