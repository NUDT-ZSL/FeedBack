const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function chromePath() {
  const candidates = [
    process.env.CHROME_BIN,
    'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    'C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
    'C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe'
  ].filter(Boolean);
  const found = candidates.find(file => fs.existsSync(file));
  if (!found) throw new Error('Set CHROME_BIN to a Chromium-based browser executable.');
  return found;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

class Cdp {
  constructor(webSocketUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.ws = new WebSocket(webSocketUrl);
  }
  ready() {
    return new Promise(resolve => { this.ws.addEventListener('open', resolve); });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }
  listen() {
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  }
  close() { this.ws.close(); }
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'autodemo-cdp-'));
  const index = path.resolve(__dirname, 'index.html');
  const child = spawn(chromePath(), [
    '--headless=new', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    new URL('file:///' + index.replace(/\\\\/g, '/')).href
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderr = '';
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser did not expose DevTools: ' + stderr)), 10000);
    child.stderr.on('data', chunk => {
      stderr += chunk;
      const marker = 'DevTools listening on ';
      const start = stderr.indexOf(marker);
      if (start >= 0) {
        const addressStart = start + marker.length;
        const tail = stderr.slice(addressStart);
        const endMatch = tail.match(/\s/);
        clearTimeout(timer);
        resolve(tail.slice(0, endMatch ? endMatch.index : undefined));
      }
    });
  });

  const port = new URL(wsUrl).port;
  let target = null;
  for (let i = 0; i < 30 && !target; i += 1) {
    const pages = await getJson(`http://127.0.0.1:${port}/json/list`);
    target = pages.find(page => page.type === 'page' && page.webSocketDebuggerUrl);
    if (!target) await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!target) throw new Error('No browser page target available.');
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  cdp.listen();
  await cdp.ready();
  try {
    await cdp.send('Runtime.enable');
    const expression = `(async () => {
      await new Promise(resolve => setTimeout(resolve, 600));
      if (document.querySelectorAll('.target').length !== 5) throw new Error('targets not rendered');
      document.querySelector('[data-edit="R-LOW-LATENCY"]').click();
      if (document.getElementById('ruleEditor').style.display !== 'grid') throw new Error('editor did not open');
      document.querySelector('[name="t2:timeout_ms"][value="R-LOW-LATENCY@v1"]').click();
      document.querySelector('[data-resolve="t2"][data-key="timeout_ms"]').click();
      if (document.getElementById('conflictCount').textContent !== '0') throw new Error('conflict was not resolved');
      document.querySelector('[data-time="b1"]').click();
      if (!document.getElementById('currentTitle').textContent.startsWith('b1')) throw new Error('timeline did not change');
      document.getElementById('verifyButton').click();
      if (!document.getElementById('logs').textContent.includes('一致性校验通过')) throw new Error('verification log missing');
      return {
        conflictCount: document.getElementById('conflictCount').textContent,
        untrustedCount: document.getElementById('untrustedCount').textContent
      };
    })()`;
    const result = await cdp.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    console.log('browser-smoke.js: click smoke passed', JSON.stringify(result.result.value));
  } finally {
    cdp.close();
    child.kill();
    await new Promise(resolve => setTimeout(resolve, 500));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
