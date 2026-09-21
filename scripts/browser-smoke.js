const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const baseUrl = process.env.BASE_URL || 'http://localhost:4173';
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (!chromePath) throw new Error('未找到 Chrome 或 Edge，可通过 CHROME_PATH 指定浏览器路径。');

const port = 9323;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-workbench-'));
const browser = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getDebugInfo() {
  for (let index = 0; index < 50; index += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch (_) { /* 等待浏览器调试端口就绪 */ }
    await sleep(100);
  }
  throw new Error('浏览器调试端口未就绪。');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(wsUrl);
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.connect(Number(parsed.port), parsed.hostname);
    let handshakeDone = false;
    let receiveBuffer = Buffer.alloc(0);
    let nextId = 1;
    const pending = new Map();
    const runtimeErrors = [];
    let settled = false;
    const finishOpen = () => {
      if (settled) return;
      settled = true;
      resolve({
        runtimeErrors,
        send(method, params = {}, sessionId) {
          const id = nextId += 1;
          const payload = { id, method, params };
          if (sessionId) payload.sessionId = sessionId;
          sendFrame(JSON.stringify(payload));
          return new Promise((done, fail) => pending.set(id, { resolve: done, reject: fail }));
        },
        close: () => socket.end()
      });
    };

    socket.on('error', reject);
    socket.on('connect', () => {
      socket.write([
        `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
        `Host: ${parsed.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        ''
      ].join('\r\n'));
    });

    socket.on('data', (chunk) => {
      receiveBuffer = Buffer.concat([receiveBuffer, chunk]);
      if (!handshakeDone) {
        const divider = receiveBuffer.indexOf('\r\n\r\n');
        if (divider < 0) return;
        const header = receiveBuffer.slice(0, divider).toString();
        if (!header.includes('HTTP/1.1 101') || !header.includes('Sec-WebSocket-Accept:')) {
          reject(new Error(`Chrome DevTools WebSocket 握手失败：${header}`));
          socket.end();
          return;
        }
        handshakeDone = true;
        receiveBuffer = receiveBuffer.slice(divider + 4);
        finishOpen();
      }
      parseFrames();
    });

    function parseFrames() {
      while (receiveBuffer.length >= 2) {
        const first = receiveBuffer[0];
        const second = receiveBuffer[1];
        const finalFrame = (first & 0x80) !== 0;
        const opcode = first & 0x0f;
        let payloadLength = second & 0x7f;
        let offset = 2;
        if (payloadLength === 126) {
          if (receiveBuffer.length < offset + 2) return;
          payloadLength = receiveBuffer.readUInt16BE(offset);
          offset += 2;
        } else if (payloadLength === 127) {
          if (receiveBuffer.length < offset + 8) return;
          payloadLength = Number(readBigUInt64Safe(receiveBuffer, offset));
          offset += 8;
        }
        if (receiveBuffer.length < offset + payloadLength) return;
        const payload = receiveBuffer.slice(offset, offset + payloadLength);
        receiveBuffer = receiveBuffer.slice(offset + payloadLength);
        if (!finalFrame || opcode === 0x9) continue;
        if (opcode === 0x8) {
          socket.end();
          return;
        }
        if (opcode !== 0x1) continue;
        const message = JSON.parse(payload.toString('utf8'));
        if (message.id && pending.has(message.id)) {
          const { resolve: done, reject: fail } = pending.get(message.id);
          pending.delete(message.id);
          message.error ? fail(new Error(JSON.stringify(message.error))) : done(message.result);
        }
        if (message.method === 'Runtime.exceptionThrown') {
          runtimeErrors.push(message.params.exceptionDetails.text);
        }
      }
    }

    function readBigUInt64Safe(buffer, offset) {
      const high = buffer.readUInt32BE(offset);
      const low = buffer.readUInt32BE(offset + 4);
      return BigInt(high) * BigInt(4294967296) + BigInt(low);
    }

    function sendFrame(text) {
      const payload = Buffer.from(text, 'utf8');
      const mask = crypto.randomBytes(4);
      let header;
      if (payload.length < 126) {
        header = Buffer.alloc(2);
        header[1] = 0x80 | payload.length;
      } else if (payload.length <= 65535) {
        header = Buffer.alloc(4);
        header[1] = 0x80 | 126;
        header.writeUInt16BE(payload.length, 2);
      } else {
        header = Buffer.alloc(10);
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(payload.length), 2);
      }
      header[0] = 0x81;
      const masked = Buffer.from(payload);
      for (let index = 0; index < masked.length; index += 1) {
        masked[index] ^= mask[index % 4];
      }
      socket.write(Buffer.concat([header, mask, masked]));
    }

  });
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

(async () => {
  const debug = await getDebugInfo();
  const client = await connect(debug.webSocketDebuggerUrl);
  const target = await client.send('Target.createTarget', { url: baseUrl });
  const attached = await client.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true
  });
  const sessionId = attached.sessionId;
  await client.send('Runtime.enable', {}, sessionId);
  await sleep(300);

  const readyExpression = `new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const cards = document.querySelectorAll('.asset-card').length;
      if (cards === 3 && document.querySelector('#validCount').textContent === '3') resolve(true);
      else if (Date.now() - started > 6000) reject(new Error('初始示例资产未渲染'));
      else setTimeout(tick, 100);
    };
    tick();
  })`;
  await evaluate(client, sessionId, readyExpression);

  await evaluate(client, sessionId, `
    document.querySelector('[data-toggle-adjustment]').click();
    true;
  `);
  await sleep(250);
  const revokedVisible = await evaluate(client, sessionId,
    "document.body.innerText.includes('已撤销')");
  if (!revokedVisible) throw new Error('撤销后界面未显示已撤销状态。');
  await evaluate(client, sessionId,
    "document.querySelector('[data-toggle-adjustment]').click(); true;");

  await evaluate(client, sessionId, `
    const life = document.getElementById('fieldLife');
    life.value = '1';
    life.dispatchEvent(new Event('input', { bubbles: true }));
    true;
  `);
  await sleep(250);
  const excluded = await evaluate(client, sessionId, `({
    valid: document.getElementById('validCount').textContent,
    invalid: document.getElementById('invalidCount').textContent,
    issue: document.body.innerText.includes('价值调整年份')
  })`);
  if (excluded.valid !== '2' || excluded.invalid !== '1' || !excluded.issue) {
    throw new Error(`错误资产隔离不符合预期：${JSON.stringify(excluded)}`);
  }

  client.close();
  browser.kill();
  console.log('浏览器冒烟测试通过：初始渲染、撤销、即时重算和错误隔离均正常。');
})().catch((error) => {
  browser.kill();
  console.error(error);
  process.exitCode = 1;
});
