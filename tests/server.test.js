const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createServer } = require("../server.js");

const serverSource = fs.readFileSync(require.resolve("../server.js"), "utf8");

test("启动器只绑定本机并提供 UTF-8 静态工作台", () => {
  assert.match(serverSource, /server\.listen\(preferredPort, ["']127\.0\.0\.1["']/);
  assert.match(serverSource, /text\/html; charset=utf-8/);
  assert.match(serverSource, /Cache-Control/);
});

test("启动服务器后可访问工作台资源，并拒绝隐藏文件", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /活动上下文恢复工作台/);

  const appResponse = await fetch(`http://127.0.0.1:${port}/js/app.js`);
  assert.equal(appResponse.status, 200);
  assert.match(await appResponse.text(), /ResumeEngine/);

  const hiddenResponse = await fetch(`http://127.0.0.1:${port}/%2e%2e/%2e%2e/.gitignore`);
  assert.equal(hiddenResponse.status, 403);

  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
