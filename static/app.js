let state = null;
let selectedId = null;

const STATUS_LABEL = { resolved: "已解决", pending: "待确认", invalid: "失效" };

async function api(path, options) {
  const resp = await fetch(path, options);
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || resp.statusText);
  return data;
}

async function refresh() {
  state = await api("/api/state");
  render();
}

function render() {
  document.getElementById("edit-count").textContent =
    `已应用 ${state.edit_count} 次编辑 · 文档长度 ${state.document.length} 字符`;
  renderDocument();
  renderComments();
}

function renderDocument() {
  const host = document.getElementById("document");
  host.innerHTML = "";
  const active = state.comments
    .filter(c => c.status !== "invalid")
    .sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const c of active) {
    if (c.start > cursor) {
      host.appendChild(document.createTextNode(state.document.slice(cursor, c.start)));
    }
    const mark = document.createElement("span");
    mark.className = "hl " + c.status + (c.id === selectedId ? " selected" : "");
    mark.textContent = state.document.slice(c.start, c.end);
    mark.title = c.content;
    mark.onclick = () => selectComment(c.id);
    host.appendChild(mark);
    cursor = c.end;
  }
  host.appendChild(document.createTextNode(state.document.slice(cursor)));
}

function renderComments() {
  const host = document.getElementById("comments");
  host.innerHTML = "";
  if (state.comments.length === 0) {
    host.textContent = "所有批注均已删除。";
    return;
  }
  for (const c of state.comments) {
    const card = document.createElement("div");
    card.className = "comment-card " + c.status + (c.id === selectedId ? " selected" : "");
    card.onclick = () => selectComment(c.id);

    const head = document.createElement("div");
    head.innerHTML = `<b>#${c.id}</b> <span class="badge ${c.status}">${STATUS_LABEL[c.status]}</span>`;
    card.appendChild(head);

    const orig = document.createElement("div");
    orig.className = "quote";
    orig.textContent = "原文：" + c.original_text;
    card.appendChild(orig);

    if (c.status !== "invalid") {
      const now = document.createElement("div");
      now.className = "quote";
      now.textContent = `当前锚定 [${c.start}, ${c.end})：` + c.anchored_text;
      card.appendChild(now);
    } else {
      const gone = document.createElement("div");
      gone.className = "quote";
      gone.innerHTML = "锚定文本已被完全删除：<del>" + escapeHtml(c.original_text) + "</del>";
      card.appendChild(gone);
    }

    const body = document.createElement("div");
    body.textContent = c.content;
    card.appendChild(body);

    if (c.status === "pending") {
      const actions = document.createElement("div");
      actions.className = "card-actions";
      const keep = document.createElement("button");
      keep.className = "primary";
      keep.textContent = "保留";
      keep.onclick = (e) => { e.stopPropagation(); keepComment(c.id); };
      const del = document.createElement("button");
      del.className = "danger";
      del.textContent = "删除";
      del.onclick = (e) => { e.stopPropagation(); deleteComment(c.id); };
      actions.appendChild(keep);
      actions.appendChild(del);
      card.appendChild(actions);
    }
    host.appendChild(card);
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function selectComment(id) {
  selectedId = (selectedId === id) ? null : id;
  render();
}

async function keepComment(id) {
  state = await api(`/api/comments/${id}/keep`, { method: "POST" });
  render();
}

async function deleteComment(id) {
  if (selectedId === id) selectedId = null;
  state = await api(`/api/comments/${id}/delete`, { method: "POST" });
  render();
}

async function resetAll() {
  selectedId = null;
  state = await api("/api/reset", { method: "POST" });
  render();
}

document.getElementById("edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("error");
  err.textContent = "";
  const f = e.target;
  const body = {
    kind: f.kind.value,
    pos: Number(f.pos.value),
    length: Number(f.length.value),
    text: f.text.value,
  };
  try {
    state = await api("/api/edits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    render();
  } catch (ex) {
    err.textContent = "编辑被拒绝：" + ex.message;
  }
});

refresh();
