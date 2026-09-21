// Offline-first work order sync server (zero-dependency, Node >= 18)
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const EDITABLE_FIELDS = ["title", "body", "assignee"];

// ---------- persistence ----------
function seedData() {
  return {
    workorders: [
      {
        id: "WO-1001",
        version: 1,
        title: "3 号泵站电机异响排查",
        body: "现场巡检发现 3 号泵站 2 号电机运行时有周期性异响，需停机检查轴承。",
        assignee: "张伟",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "WO-1002",
        version: 1,
        title: "西区管网压力异常复核",
        body: "SCADA 报警西区管网压力低于阈值，需现场复核压力表并记录读数。",
        assignee: "李娜",
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (e) {
    const data = seedData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    return data;
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

let db = loadData();

function findWO(id) {
  return db.workorders.find((w) => w.id === id);
}

// ---------- helpers ----------
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("forbidden");
  }
  fs.readFile(file, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(content);
  });
}

// ---------- sync logic ----------
// Client sends the full ordered op log. Server collapses ops per
// (workorderId, field) keeping the FIRST oldValue as base and the LAST
// newValue as final intent, then judges each intent against current state:
//   - server value === base oldValue  -> safe to apply
//   - server value === final newValue -> already applied (no-op)
//   - otherwise                       -> conflict, needs user arbitration
function handleSync(req, res, payload) {
  const ops = Array.isArray(payload.ops) ? payload.ops : [];
  const intents = new Map(); // key: woId|field
  for (const op of ops) {
    if (!op || !EDITABLE_FIELDS.includes(op.field)) continue;
    const key = op.workorderId + "|" + op.field;
    const prev = intents.get(key);
    if (prev) {
      prev.newValue = op.newValue;
      prev.lastSeq = op.seq;
      prev.opCount += 1;
    } else {
      intents.set(key, {
        workorderId: op.workorderId,
        field: op.field,
        baseValue: op.oldValue,
        newValue: op.newValue,
        firstSeq: op.seq,
        lastSeq: op.seq,
        opCount: 1,
      });
    }
  }

  const results = [];
  const conflicts = [];
  const touched = new Set();

  for (const intent of intents.values()) {
    const wo = findWO(intent.workorderId);
    if (!wo) {
      results.push({ ...intent, status: "orphaned", reason: "工单在服务端不存在" });
      continue;
    }
    const serverValue = wo[intent.field];
    if (serverValue === intent.newValue) {
      results.push({ ...intent, status: "noop", serverValue });
    } else if (serverValue === intent.baseValue) {
      wo[intent.field] = intent.newValue;
      touched.add(wo.id);
      results.push({ ...intent, status: "applied", serverValue: intent.newValue });
    } else {
      conflicts.push({
        workorderId: wo.id,
        field: intent.field,
        baseValue: intent.baseValue,
        localValue: intent.newValue,
        serverValue,
        opCount: intent.opCount,
      });
      results.push({ ...intent, status: "conflict", serverValue });
    }
  }

  for (const id of touched) {
    const wo = findWO(id);
    wo.version += 1;
    wo.updatedAt = new Date().toISOString();
  }
  if (touched.size > 0) saveData();

  send(res, 200, {
    results,
    conflicts,
    workorders: db.workorders,
  });
}

// Client sends arbitration decisions for conflicted fields only.
// Only the affected workorders/fields are recomputed; everything else
// is left untouched.
function handleResolve(req, res, payload) {
  const decisions = Array.isArray(payload.decisions) ? payload.decisions : [];
  const touched = new Set();
  const applied = [];
  for (const d of decisions) {
    if (!d || !EDITABLE_FIELDS.includes(d.field)) continue;
    const wo = findWO(d.workorderId);
    if (!wo) continue;
    // guard: only apply if the server value is still the one the user saw
    // when arbitrating, otherwise report a fresh conflict.
    if (wo[d.field] !== d.expectedServerValue) {
      applied.push({
        workorderId: d.workorderId,
        field: d.field,
        status: "stale",
        serverValue: wo[d.field],
      });
      continue;
    }
    wo[d.field] = d.value;
    touched.add(wo.id);
    applied.push({ workorderId: d.workorderId, field: d.field, status: "resolved", value: d.value });
  }
  for (const id of touched) {
    const wo = findWO(id);
    wo.version += 1;
    wo.updatedAt = new Date().toISOString();
  }
  if (touched.size > 0) saveData();
  send(res, 200, { applied, workorders: db.workorders });
}

// Simulate another client editing directly on the server (for demo of
// conflicts). Not used by the offline client itself.
function handleServerEdit(req, res, payload) {
  const wo = findWO(payload.workorderId);
  if (!wo || !EDITABLE_FIELDS.includes(payload.field)) {
    return send(res, 400, { error: "invalid workorder or field" });
  }
  wo[payload.field] = String(payload.value);
  wo.version += 1;
  wo.updatedAt = new Date().toISOString();
  saveData();
  send(res, 200, { workorder: wo });
}

function handleReset(req, res) {
  db = seedData();
  saveData();
  send(res, 200, { workorders: db.workorders });
}

// ---------- router ----------
const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  try {
    if (req.method === "GET" && url === "/api/workorders") {
      return send(res, 200, { workorders: db.workorders });
    }
    if (req.method === "POST" && url === "/api/sync") {
      return handleSync(req, res, await readBody(req));
    }
    if (req.method === "POST" && url === "/api/resolve") {
      return handleResolve(req, res, await readBody(req));
    }
    if (req.method === "POST" && url === "/api/server-edit") {
      return handleServerEdit(req, res, await readBody(req));
    }
    if (req.method === "POST" && url === "/api/reset") {
      return handleReset(req, res);
    }
    if (req.method === "GET") {
      return serveStatic(req, res);
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: String(e && e.message ? e.message : e) });
  }
});

server.listen(PORT, () => {
  console.log(`Work order sync server running at http://localhost:${PORT}`);
});
