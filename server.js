const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.OFFLINE_NOTES_DATA
  ? path.resolve(process.env.OFFLINE_NOTES_DATA)
  : path.join(__dirname, 'data', 'notes.json');

const EMPTY_DB = { notes: {}, processed: {} };

function loadDb() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const db = JSON.parse(raw);
    return { notes: db.notes || {}, processed: db.processed || {} };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return structuredClone(EMPTY_DB);
  }
}

  function saveDb(db) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
  }

function publicNote(note) {
  if (!note || note.deleted) return null;
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    version: note.version,
    updatedAt: note.updatedAt
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      raw += chunk;
      if (Buffer.byteLength(raw, 'utf8') > 1_000_000) {
        reject(Object.assign(new Error('PAYLOAD_TOO_LARGE'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('INVALID_JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function conflictBody(note, reason) {
  return {
    error: 'VERSION_CONFLICT',
    conflict: {
      reason,
      server: note
        ? { ...note }
        : null
    }
  };
}

function createServer(db = loadDb()) {
  function remember(opId, status, body) {
    if (opId) db.processed[opId] = { status, body };
  }

  function commit(fn, opId) {
    if (opId && db.processed[opId]) {
      const seen = db.processed[opId];
      return { status: seen.status, body: seen.body, replay: true };
    }
    const result = fn();
    if (!result || result.noCache) return result;
    if (opId && result.status < 500) remember(opId, result.status, result.body);
    saveDb(db);
    return result;
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const send = (status, body, extra = {}) => {
      const isBuffer = Buffer.isBuffer(body);
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...extra
      });
      res.end(isBuffer ? body : JSON.stringify(body));
    };

    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(200, { ok: true });
      }

      if (req.method === 'GET' && url.pathname === '/api/notes') {
        const notes = Object.values(db.notes).map(publicNote).filter(Boolean);
        return send(200, { notes });
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/notes/')) {
        const id = decodeURIComponent(url.pathname.split('/').pop());
        return send(200, { note: publicNote(db.notes[id]) });
      }

      if (req.method === 'POST' && url.pathname === '/api/notes/simulate-remote-change') {
        const body = await readJson(req);
        const existing = db.notes[body.id];
        if (!existing || existing.deleted) return send(404, { error: 'NOTE_NOT_FOUND' });
        existing.title = String(body.title || existing.title);
        existing.content = String(
          body.content ?? `${existing.content}\n\n[外勤主管在另一台设备补充] ${new Date().toLocaleString('zh-CN')}`
        );
        existing.version += 1;
        existing.updatedAt = new Date().toISOString();
        saveDb(db);
        return send(200, { note: publicNote(existing) });
      }

      if (req.method === 'POST' && url.pathname === '/api/notes') {
        const body = await readJson(req);
        if (!body.opId || typeof body.opId !== 'string') {
          return send(400, { error: 'OP_ID_REQUIRED' });
        }
        const id = body.id || crypto.randomUUID();
        const result = commit(() => {
          if (db.notes[id] && !db.notes[id].deleted) {
            return { status: 409, body: conflictBody(db.notes[id], 'created_concurrently') };
          }
          const now = new Date().toISOString();
          const note = {
            id,
            title: String(body.title || '未命名笔记'),
            content: String(body.content || ''),
            version: 1,
            updatedAt: now
          };
          db.notes[id] = note;
          return { status: 201, body: { note } };
        }, body.opId);
        return send(result.status, result.body);
      }

      const noteMatch = url.pathname.match(/^\/api\/notes\/([^/]+)(?:\/resolve)?$/);
      if (noteMatch) {
        const id = decodeURIComponent(noteMatch[1]);
        const body = await readJson(req);
        const isResolve = url.pathname.endsWith('/resolve');

        if (!body.opId || typeof body.opId !== 'string') {
          return send(400, { error: 'OP_ID_REQUIRED' });
        }

        const result = commit(() => {
          const note = db.notes[id];
          const now = new Date().toISOString();

          if (isResolve) {
            const expected = Number(body.baseVersion);
            if (!Number.isInteger(expected) || expected < 0) {
              return { status: 400, body: { error: 'BASE_VERSION_REQUIRED' } };
            }
            if (!note || note.version !== expected) {
              return {
                status: 409,
                body: conflictBody(note || null, 'server_changed_again_before_resolution')
              };
            }

            if (body.choice === 'local') {
              if (!note.deleted && body.localDeleted) {
                note.deleted = true;
                note.version += 1;
                note.updatedAt = now;
              } else if (!body.localDeleted) {
                note.title = String(body.title || '未命名笔记');
                note.content = String(body.content || '');
                note.deleted = false;
                note.version += 1;
                note.updatedAt = now;
              }
              return { status: 200, body: { note: publicNote(note), resolved: true } };
            }

            if (body.choice === 'server') {
              return { status: 200, body: { note: publicNote(note), resolved: true } };
            }

            if (body.choice === 'manual') {
              note.title = String(body.title || '未命名笔记');
              note.content = String(body.content || '');
              note.deleted = Boolean(body.deleted);
              note.version += 1;
              note.updatedAt = now;
              return { status: 200, body: { note: publicNote(note), resolved: true } };
            }

            return { status: 400, body: { error: 'INVALID_RESOLUTION_CHOICE' } };
          }

          if (req.method !== 'PATCH' && req.method !== 'DELETE') {
            return { status: 405, body: { error: 'METHOD_NOT_ALLOWED' }, noCache: true };
          }
          const expected = Number(body.baseVersion);
          if (!Number.isInteger(expected) || expected < 0) {
            return { status: 400, body: { error: 'BASE_VERSION_REQUIRED' } };
          }
          if (!note || note.version !== expected) {
            const reason = !note || note.deleted
              ? 'deleted_remotely_while_editing'
              : 'updated_remotely_while_editing';
            return { status: 409, body: conflictBody(note || null, reason) };
          }

          if (req.method === 'DELETE') {
            note.deleted = true;
            note.version += 1;
            note.updatedAt = now;
            return { status: 200, body: { note: null } };
          }

          note.title = String(body.title || '未命名笔记');
          note.content = String(body.content || '');
          note.version += 1;
          note.updatedAt = now;
          return { status: 200, body: { note: publicNote(note) } };
        }, body.opId);

        return send(result.status, result.body);
      }

      if (req.method === 'GET') return serveStatic(url.pathname, send);
      return send(404, { error: 'NOT_FOUND' });
    } catch (error) {
      send(error.status || 500, { error: error.message || 'INTERNAL_ERROR' });
    }
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};

async function serveStatic(pathname, send) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(__dirname, 'public', safePath);
  if (!file.startsWith(path.join(__dirname, 'public'))) {
    return send(403, { error: 'FORBIDDEN' });
  }
  try {
    const content = await fsp.readFile(file);
    return send(200, content, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  } catch {
    return send(404, { error: 'NOT_FOUND' });
  }
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`离线现场笔记应用已启动：http://localhost:${PORT}`);
  });
}

module.exports = { createServer, loadDb, DATA_FILE };
