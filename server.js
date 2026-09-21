const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const PORT = process.env.PORT || 3000;
const FIELDS = ['title', 'body', 'assignee'];

function seed() {
  return {
    workorders: [
      { id: 'WO-1001', title: '机房空调巡检', body: '检查 3 楼机房空调运行状态，记录回风温度。', assignee: '张伟', version: 1, updatedAt: Date.now() },
      { id: 'WO-1002', title: '更换会议室投影仪灯泡', body: '会议室 B 投影仪亮度不足，需更换灯泡并校准色彩。', assignee: '李娜', version: 1, updatedAt: Date.now() },
      { id: 'WO-1003', title: '仓库门禁故障排查', body: '东门门禁刷卡无响应，排查控制器与线路。', assignee: '王强', version: 1, updatedAt: Date.now() }
    ]
  };
}

let db;
function save() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
function load() {
  try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { db = seed(); save(); }
}
load();

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// 仅修改指定字段并递增版本：裁决与同步都只影响传入的字段
function applyFields(wo, entries) {
  for (const { field, value } of entries) wo[field] = value;
  wo.version += 1;
  wo.updatedAt = Date.now();
  save();
}

async function handleApi(req, res) {
  const url = req.url.split('?')[0];
  const m = url.match(/^\/api\/workorders\/([\w-]+)\/(sync|resolve)$/);

  if (req.method === 'GET' && url === '/api/state') {
    return send(res, 200, { workorders: db.workorders, serverTime: Date.now() });
  }
  if (req.method === 'POST' && url === '/api/reset') {
    db = seed(); save();
    return send(res, 200, { ok: true });
  }
  // 演示用：模拟其它终端/后台对服务端数据的直接修改
  if (req.method === 'POST' && url === '/api/admin/mutate') {
    const { id, field, value } = await readBody(req);
    const wo = db.workorders.find(w => w.id === id);
    if (!wo || !FIELDS.includes(field)) return send(res, 400, { error: 'bad request' });
    applyFields(wo, [{ field, value }]);
    return send(res, 200, { workorder: wo });
  }
  if (m && req.method === 'POST') {
    const wo = db.workorders.find(w => w.id === m[1]);
    if (!wo) return send(res, 404, { error: 'not found' });
    const body = await readBody(req);

    if (m[2] === 'sync') {
      // 客户端按顺序提交合并后的字段意图：{field, baseValue, value}
      // baseValue 是本地首次修改该字段时见到的服务端值
      const applied = [], conflicts = [];
      for (const it of body.intents || []) {
        if (!FIELDS.includes(it.field)) continue;
        const cur = wo[it.field];
        if (cur === it.value) {
          applied.push({ field: it.field, value: cur, note: 'already-same' });
        } else if (cur === it.baseValue) {
          // 服务端该字段自本地编辑以来未变 → 可安全应用
          applied.push({ field: it.field, value: it.value, note: 'applied' });
        } else {
          // 服务端已变成第三个值 → 冲突，交由客户端裁决
          conflicts.push({ field: it.field, baseValue: it.baseValue, localValue: it.value, serverValue: cur });
        }
      }
      const toApply = applied.filter(a => a.note === 'applied')
        .map(a => ({ field: a.field, value: a.value }));
      if (toApply.length) applyFields(wo, toApply);
      return send(res, 200, { applied, conflicts, version: wo.version, workorder: wo });
    }

    // resolve：只应用裁决涉及的字段，其余字段与版本历史不受影响
    const entries = (body.resolutions || [])
      .filter(r => FIELDS.includes(r.field))
      .map(r => ({ field: r.field, value: r.value }));
    if (entries.length) applyFields(wo, entries);
    return send(res, 200, { workorder: wo });
  }
  send(res, 404, { error: 'not found' });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
function serveStatic(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, 'public', path.normalize(p));
  if (!file.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) handleApi(req, res).catch(e => send(res, 500, { error: String(e) }));
  else serveStatic(req, res);
}).listen(PORT, () => console.log(`工单离线同步服务已启动: http://localhost:${PORT}`));
