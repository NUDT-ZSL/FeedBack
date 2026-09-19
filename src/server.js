import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore, ValidationError } from "./store.js";
import {
  addMember,
  addRoleSource,
  addScope,
  addScopeDirective,
  addScopeEdge,
  confirmOperation,
  createRole,
  loadPageData,
  openPage,
  resolveConflict,
  resolvePendingOperation,
  setRoleGrants,
  startOperation,
  updateRole
} from "./actions.js";
import { seedDemo } from "./seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const store = createStore();
seedDemo(store);

const json = (response, status, value) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(value));
};

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new ValidationError("BODY_TOO_LARGE", "请求体过大"));
    });
    request.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new ValidationError("INVALID_JSON", "请求不是合法 JSON", { detail: error.message }));
      }
    });
    request.on("error", reject);
  });
}

const actions = {
  "members/add": addMember,
  "roles/create": createRole,
  "roles/grants": setRoleGrants,
  "members/role": updateRole,
  "roles/source": addRoleSource,
  "scopes/add": addScope,
  "scopes/edge": addScopeEdge,
  "scopes/directive": addScopeDirective,
  "conflicts/resolve": resolveConflict,
  "pages/open": openPage,
  "pages/load": loadPageData,
  "operations/start": startOperation,
  "operations/confirm": confirmOperation,
  "operations/resolve-pending": resolvePendingOperation
};

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/state") {
    return json(response, 200, store.snapshot());
  }
  if (request.method === "GET" && pathname === "/api/events") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive"
    });
    response.write(`event: snapshot\ndata: ${JSON.stringify(store.snapshot())}\n\n`);
    const unsubscribe = store.subscribe((event) => {
      response.write(`event: policy\ndata: ${JSON.stringify({ event, state: store.snapshot() })}\n\n`);
    });
    request.on("close", unsubscribe);
    return;
  }
  if (request.method !== "POST") return json(response, 405, { error: { code: "METHOD_NOT_ALLOWED" } });
  const actionName = pathname.replace("/api/", "");
  const action = actions[actionName];
  if (!action) return json(response, 404, { error: { code: "UNKNOWN_ACTION", location: "url" } });
  try {
    const input = await readBody(request);
    const result = await action(store, input);
    return json(response, 200, { ok: true, result, state: store.snapshot() });
  } catch (error) {
    if (error instanceof ValidationError) {
      return json(response, 400, {
        ok: false,
        error: { code: error.code, message: error.message, details: error.details }
      });
    }
    console.error(error);
    return json(response, 500, { ok: false, error: { code: "INTERNAL", message: error.message } });
  }
}

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"]
]);

function serveStatic(response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const target = path.normalize(path.join(rootDir, "public", requestedPath));
  const publicDir = path.join(rootDir, "public");
  if (!target.startsWith(publicDir)) {
    response.writeHead(403);
    return response.end("Forbidden");
  }
  fs.readFile(target, (error, content) => {
    if (error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return response.end("Not found");
    }
    response.writeHead(200, { "content-type": mimeTypes.get(path.extname(target)) ?? "application/octet-stream" });
    response.end(content);
  });
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    handleApi(request, response, url.pathname).catch((error) => {
      json(response, 500, { ok: false, error: { code: "INTERNAL", message: error.message } });
    });
  } else {
    serveStatic(response, url.pathname);
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`多角色授权工作台已启动：http://localhost:${port}`);
});
