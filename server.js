import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkbench, ValidationError, PermissionError } from "./core.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 8080);
const workbench = createWorkbench(() => Date.now());
const subscribers = new Set();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function broadcast(change) {
  const payload = JSON.stringify({ type: "state", model: workbench.getViewModel(), change });
  for (const response of subscribers) response.write(`data: ${payload}\n\n`);
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 2_000_000) {
      const error = new ValidationError("请求体过大", [{ kind: "too-large", path: "body", message: "请控制在 2MB 内" }]);
      throw error;
    }
  }
  return body ? JSON.parse(body) : {};
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

const actions = {
  "members.add": input => workbench.addMember(input),
  "roles.upsert": input => workbench.upsertRole(input),
  "scopes.upsert": input => workbench.upsertScope(input),
  "claims.add": input => workbench.addClaim(input),
  "conflicts.resolve": input => workbench.resolveConflict(input),
  "sessions.open": input => workbench.openSession(input),
  "operations.initiate": input => workbench.initiateOperation(input),
  "operations.confirm": input => workbench.confirmOperation(input),
  "operations.cancel": input => workbench.cancelOperation(input)
};

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/state") {
    return sendJson(response, 200, { model: workbench.getViewModel() });
  }
  if (request.method === "GET" && url.pathname === "/api/events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    response.write(": connected\n\n");
    response.write(`data: ${JSON.stringify({ type: "state", model: workbench.getViewModel() })}\n\n`);
    subscribers.add(response);
    request.on("close", () => subscribers.delete(response));
    return;
  }
  if (request.method !== "POST") return sendJson(response, 405, { error: { message: "仅支持 POST" } });
  const actionName = url.pathname.replace("/api/", "");
  const action = actions[actionName];
  if (!action) return sendJson(response, 404, { error: { message: "接口不存在", code: "NOT_FOUND", path: url.pathname } });
  try {
    const input = await readJson(request);
    const result = await action(input);
    const model = workbench.getViewModel();
    broadcast(result?.event ? { event: result.event, affected: result.affected } : null);
    return sendJson(response, 200, { ok: true, model, ...result });
  } catch (error) {
    if (error instanceof ValidationError) return sendJson(response, 400, { error: { message: error.message, code: error.code, details: error.details } });
    if (error instanceof PermissionError) return sendJson(response, 403, { error: { message: error.message, code: error.code, details: error.details, model: workbench.getViewModel() } });
    return sendJson(response, 400, { error: { message: error.message, code: error.code || "BAD_REQUEST" } });
  }
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(requested).replace(/^([/\\])+/, "");
  const filePath = join(root, "public", safePath);
  if (!filePath.startsWith(join(root, "public"))) {
    response.writeHead(403); response.end("Forbidden"); return;
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) return handleApi(request, response, url);
  return serveStatic(response, url.pathname);
});

server.listen(port, () => {
  console.log(`权限收敛工作台已启动：http://localhost:${port}`);
});
