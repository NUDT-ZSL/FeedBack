const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const root = __dirname;
const preferredPort = Number(process.env.PORT) || 17321;

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon']
]);

function sendFile(response, requestPath) {
  const requested = requestPath === '/' ? '/index.html' : requestPath.split('?')[0];
  const extension = path.extname(requested.split('/').pop() || '').toLowerCase();
  if (requested !== '/index.html' && (!mimeTypes.has(extension) || requested.split('/').some((part) => part === '.' || part === '..' || part.startsWith('.')))) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  const relativePath = requested.replace(/^\/+/, '');
  const filePath = path.resolve(root, relativePath);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;

  if (filePath !== root && !filePath.startsWith(rootWithSep)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    response.end(data);
  });
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  sendFile(response, url.pathname);
});

if (module.exports) {
  module.exports = { sendFile, createServer: () => http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    sendFile(response, url.pathname);
  }) };
}

if (require.main === module) {
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`端口 ${preferredPort} 已被占用，请关闭占用程序后重试，或设置 PORT=17322 后启动。`);
      process.exit(1);
    }
    throw error;
  });

  server.listen(preferredPort, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${preferredPort}/`;
    console.log(`活动上下文工作台已启动：${url}`);
    console.log('按 Ctrl+C 可停止本地服务。');
    if (process.env.OPEN_BROWSER !== '0') {
      exec(`cmd /c start "" "${url}"`);
    }
  });
}
