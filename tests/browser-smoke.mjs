import { spawn } from 'node:child_process';

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const target = `file:///${process.cwd().replace(/\\/g, '/')}/index.html`;
const child = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=9223',
  `--user-data-dir=${process.env.TEMP}/slice-explorer-smoke-${Date.now()}`, target
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  let version;
  for (let i = 0; i < 30; i += 1) {
    await sleep(200);
    version = await fetch('http://127.0.0.1:9223/json/version').then((r) => r.json()).catch(() => null);
    if (version) break;
  }
  if (!version) throw new Error('Chrome DevTools endpoint did not start');
  const pages = await fetch('http://127.0.0.1:9223/json/list').then((r) => r.json());
  const page = pages.find((item) => item.url.startsWith('file:')) || pages[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    }
  });
  await send('Runtime.enable');
  await sleep(500);
  const run = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true
    });
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails, null, 2));
    }
    return result.result.value;
  };
  const initial = await run(`({
    rows: document.querySelector('#datasetStats').textContent,
    summary: document.querySelector('#resultSummary').textContent,
    rowsCount: document.querySelectorAll('tbody tr').length,
    firstCell: document.querySelector('tbody tr td').textContent
  })`);
  if (!initial.rows.includes('60 行')) throw new Error('sample data not rendered');
  if (initial.firstCell.includes('S000')) throw new Error('unique order id selected by default');

  const smoke = await run(`(async () => {
    document.querySelector('tbody tr [data-action="mark"]').click();
    document.querySelector('#findingTitle').value = '浏览器冒烟发现';
    document.querySelector('#findingForm').requestSubmit();
    await new Promise(r => setTimeout(r, 100));
    const firstBadge = document.querySelector('.finding-card .badge').textContent;
    document.querySelector('.filter-card [data-role="dim-value"]').click();
    await new Promise(r => setTimeout(r, 100));
    return {
      firstBadge,
      afterFinding: document.querySelectorAll('.finding-card').length,
      afterFilter: document.querySelector('.finding-card .badge').textContent,
      staleReason: document.querySelector('.stale-reason')?.textContent || ''
    };
  })()`);
  if (smoke.afterFinding !== 1 || !smoke.firstBadge.includes('当前有效')) throw new Error('finding was not saved valid');
  if (!smoke.afterFilter.includes('已失效') || !smoke.staleReason.includes('筛选')) {
    throw new Error('filter change did not invalidate finding');
  }
  const broken = await run(`(async () => {
    window.confirm = () => true;
    document.querySelector('tbody tr [data-action="mark"]').click();
    document.querySelector('#findingTitle').value = '浏览器下游发现';
    document.querySelector('#referencePicker input').click();
    document.querySelector('#findingForm').requestSubmit();
    await new Promise(r => setTimeout(r, 100));
    document.querySelectorAll('.finding-card')[1]
      .querySelector('[data-action="delete"]').click();
    await new Promise(r => setTimeout(r, 100));
    const downstream = document.querySelector('.finding-card');
    return {
      title: downstream.querySelector('.finding-title').textContent,
      badges: downstream.querySelector('.badges').textContent,
      chain: downstream.querySelector('.chain').textContent
    };
  })()`);
  if (!broken.badges.includes('含断链') || !broken.chain.includes('浏览器冒烟发现')) {
    throw new Error(`deleted upstream reference was not preserved: ${JSON.stringify(broken)}`);
  }
  ws.close();
  console.log('browser smoke test passed', initial, smoke, broken);
} finally {
  child.kill();
}
