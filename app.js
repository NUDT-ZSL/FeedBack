import { findRelated, normalizeText, parseTags } from "./core.js";

const STORAGE_KEY = "clue-notes:v1";

const elements = {
  newNoteBtn: document.querySelector("#newNoteBtn"),
  noteCount: document.querySelector("#noteCount"),
  searchInput: document.querySelector("#searchInput"),
  noteList: document.querySelector("#noteList"),
  trailNav: document.querySelector("#trailNav"),
  relatedList: document.querySelector("#relatedList"),
  deleteBtn: document.querySelector("#deleteBtn"),
  saveBtn: document.querySelector("#saveBtn"),
  form: document.querySelector("#noteForm"),
  titleInput: document.querySelector("#titleInput"),
  tagsInput: document.querySelector("#tagsInput"),
  bodyInput: document.querySelector("#bodyInput"),
  editorTitleLabel: document.querySelector("#editorTitleLabel"),
  saveStatus: document.querySelector("#saveStatus")
};

let state = loadState();
let selectedId = state.notes[0]?.id ?? null;
let trail = selectedId ? [selectedId] : [];
let saveTimer = 0;
let draftId = null;

function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? `{"notes":[]}`);
    return Array.isArray(saved.notes) ? saved : { notes: [] };
  } catch {
    return { notes: [] };
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function escapeHtml(value) {
  return normalizeText(String(value ?? ""))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function selectedNote() {
  return state.notes.find((note) => note.id === selectedId) ?? null;
}

function displayTitle(note) {
  return normalizeText(note.title) || "未命名笔记";
}

function preview(text, length = 92) {
  const clean = normalizeText(text);
  return clean.length > length ? `${clean.slice(0, length)}…` : clean;
}

function startNewNote() {
  window.clearTimeout(saveTimer);
  draftId = null;
  const now = Date.now();
  const note = { id: createId(), title: "", tags: [], body: "", createdAt: now, updatedAt: now };
  state.notes = [note, ...state.notes];
  selectedId = note.id;
  trail = [note.id];
  persist();
  render();
  elements.titleInput.focus();
}

function selectNote(id, options = {}) {
  if (!state.notes.some((note) => note.id === id)) return;
  window.clearTimeout(saveTimer);
  draftId = null;
  selectedId = id;
  if (options.fromRelated) {
    const existing = trail.indexOf(id);
    if (existing >= 0) trail = trail.slice(0, existing + 1);
    else trail.push(id);
  } else if (options.trailIndex !== undefined) {
    trail = trail.slice(0, options.trailIndex + 1);
  } else {
    trail = [id];
  }
  render();
}

function collectFormInto(note) {
  note.title = normalizeText(elements.titleInput.value);
  note.tags = parseTags(elements.tagsInput.value);
  note.body = normalizeText(elements.bodyInput.value);
  note.updatedAt = Date.now();
}

function flushDraft() {
  const note = selectedNote();
  if (!note || draftId !== note.id) return;
  collectFormInto(note);
  draftId = null;
  persist();
  render({ keepFocus: true });
}

function scheduleSave() {
  const note = selectedNote();
  if (!note) return;
  draftId = note.id;
  window.clearTimeout(saveTimer);
  elements.saveStatus.textContent = "正在更新关联…";
  saveTimer = window.setTimeout(() => {
    flushDraft();
    elements.saveStatus.textContent = "已保存，关联结果已按当前内容重新计算。";
  }, 350);
}

function deleteSelected() {
  const note = selectedNote();
  if (!note) return;
  window.clearTimeout(saveTimer);
  draftId = null;
  const removedTrailIndex = trail.indexOf(note.id);
  state.notes = state.notes.filter((item) => item.id !== note.id);
  if (removedTrailIndex > 0) {
    trail.splice(removedTrailIndex, 1);
    selectedId = trail[Math.min(removedTrailIndex, trail.length - 1)];
  } else {
    selectedId = state.notes[0]?.id ?? null;
    trail = selectedId ? [selectedId] : [];
  }
  persist();
  render();
}

function renderNoteList() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const notes = [...state.notes]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((note) => {
      if (!query) return true;
      return [note.title, note.body, note.tags.join(" ")].join("\n").toLowerCase().includes(query);
    });

  elements.noteCount.textContent = state.notes.length;
  if (state.notes.length === 0) {
    elements.noteList.innerHTML = `
      <div class="empty-state">
        还没有笔记。点击“新建笔记”会立刻把空白笔记加入列表，也可以
        <button type="button" data-action="sample" class="ghost">载入示例</button>。
      </div>`;
    return;
  }
  if (notes.length === 0) {
    elements.noteList.innerHTML = `<div class="empty-state">没有符合搜索条件的笔记。</div>`;
    return;
  }

  elements.noteList.innerHTML = notes.map((note) => {
    const tags = note.tags.slice(0, 4).map((tag) => `<span class="tag-chip">#${escapeHtml(tag)}</span>`).join("");
    return `
      <button type="button" class="note-item ${note.id === selectedId ? "active" : ""}" data-id="${note.id}">
        <h3>${escapeHtml(displayTitle(note))}</h3>
        <div class="meta-line">${tags || '<span class="tag-chip">无标签</span>'}</div>
        <p>${escapeHtml(preview(note.body)) || "暂无正文"}</p>
      </button>`;
  }).join("");
}

function syncEditor() {
  const note = selectedNote();
  elements.editorTitleLabel.textContent = note ? displayTitle(note) : "未选择笔记";
  elements.deleteBtn.hidden = !note;
  elements.saveBtn.textContent = note ? "立即保存并重算" : "保存新笔记";
  if (!note) {
    elements.form.reset();
    elements.saveStatus.textContent = "";
    return;
  }
  elements.titleInput.value = note.title;
  elements.tagsInput.value = note.tags.join(", ");
  elements.bodyInput.value = note.body;
}

function renderTrail() {
  if (!selectedId) {
    elements.trailNav.innerHTML = "";
    return;
  }
  elements.trailNav.innerHTML = trail.map((id, index) => {
    const note = state.notes.find((item) => item.id === id);
    if (!note) return "";
    return `
      <button type="button" class="${id === selectedId ? "current" : ""}" data-trail-index="${index}"
        title="退回到这条笔记">${escapeHtml(displayTitle(note))}</button>
      ${index < trail.length - 1 ? '<span class="trail-sep">→</span>' : ""}`;
  }).join("");
}

function strength(score) {
  if (score >= 30) return "很强";
  if (score >= 18) return "较强";
  if (score >= 10) return "中等";
  return "偏弱";
}

function makeSnippet(note, clue) {
  const value = clue.value;
  const inTitle = note.title.toLowerCase().includes(value.toLowerCase());
  const source = inTitle ? note.title : note.body;
  const index = source.toLowerCase().indexOf(value.toLowerCase());
  if (index < 0) return "";
  const start = Math.max(0, index - 18);
  const end = Math.min(source.length, index + value.length + 24);
  const excerpt = `${start > 0 ? "…" : ""}${source.slice(start, end)}${end < source.length ? "…" : ""}`;
  return `<p class="snippet">${inTitle ? "标题" : "正文"}：${escapeHtml(excerpt).replace(
    escapeHtml(value), `<mark>${escapeHtml(value)}</mark>`
  )}</p>`;
}

function makeTagSnippet(note, tagClue) {
  const tag = tagClue.value.toLowerCase();
  const inTitle = note.title.toLowerCase().includes(tag);
  const source = inTitle ? note.title : note.body;
  const index = source.toLowerCase().indexOf(tag);
  if (index < 0) {
    return `<p class="snippet">标签：${escapeHtml(tagClue.value)}</p>`;
  }
  const start = Math.max(0, index - 14);
  const end = Math.min(source.length, index + tag.length + 20);
  const excerpt = `${start > 0 ? "…" : ""}${source.slice(start, end)}${end < source.length ? "…" : ""}`;
  return `<p class="snippet">${inTitle ? "标题" : "正文"}：${escapeHtml(excerpt).replace(
    escapeHtml(tagClue.value), `<mark>${escapeHtml(tagClue.value)}</mark>`
  )}</p>`;
}

function renderRelated() {
  const note = selectedNote();
  if (!note) {
    elements.relatedList.innerHTML = `<div class="empty-state">选择或新建一条笔记后，这里会实时展示它的关联。</div>`;
    return;
  }

  const related = findRelated(state.notes, selectedId);
  if (related.length === 0) {
    elements.relatedList.innerHTML = `
      <div class="island-state">
        <strong>这条笔记当前是孤立的</strong>
        没有发现共同标签，也没有足够明确的共享文本线索。补充标签或在其他笔记中写入相同主题后，关联会自动出现。
      </div>`;
    return;
  }

  elements.relatedList.innerHTML = related.map((item) => {
    const tags = item.tagClues.slice(0, 5)
      .map((clue) => `<span class="reason-chip tag">共同标签 #${escapeHtml(clue.value)}</span>`)
      .join("");
    const texts = item.textClues.slice(0, 5)
      .map((clue) => `<span class="reason-chip text" title="线索分 ${clue.score}">“${escapeHtml(clue.value)}”${clue.inTitle ? " · 标题" : ""}</span>`)
      .join("");
    return `
      <button type="button" class="related-card" data-jump="${item.id}">
        <div class="related-top">
          <h3>${escapeHtml(displayTitle(item.note))}</h3>
          <span class="score">相关度：${strength(item.score)} · ${item.score.toFixed(1)}</span>
        </div>
        <div class="reason-block">
          ${tags ? `<div class="reason-line"><span class="reason-label">标签</span><span class="clue-wrap">${tags}</span></div>` : ""}
          ${texts ? `<div class="reason-line"><span class="reason-label">文本</span><span class="clue-wrap">${texts}</span></div>` : ""}
        </div>
        ${item.textClues[0]
          ? makeSnippet(item.note, item.textClues[0])
          : item.tagClues[0] ? makeTagSnippet(item.note, item.tagClues[0]) : ""}
      </button>`;
  }).join("");
}

function render(options = {}) {
  const active = document.activeElement?.id;
  const cursor = [elements.titleInput, elements.tagsInput, elements.bodyInput]
    .includes(document.activeElement)
    ? { start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
    : null;

  renderNoteList();
  if (!options.keepFocus) syncEditor();
  renderTrail();
  renderRelated();

  if (options.keepFocus && active) {
    const field = document.querySelector(`#${active}`);
    if (field) {
      field.focus();
      if (cursor && Number.isInteger(cursor.start)) field.setSelectionRange(cursor.start, cursor.end);
    }
  }
}

function loadSampleNotes() {
  const now = Date.now();
  const samples = [
    {
      title: "项目复盘：个人知识工具的需求",
      tags: ["产品设计", "知识管理", "复盘"],
      body: "会议决定优先处理标签过滤、双向链接和关联理由。用户从一条笔记出发时，要能看到共同标签和正文里的具体线索，而不是只得到一个黑盒分数。"
    },
    {
      title: "关联结果为什么必须可解释",
      tags: ["产品设计", "知识管理"],
      body: "如果两条笔记因为共同标签或相同的关键短语而相关，界面应该直接说明原因。可解释的关联能帮助用户判断这条链接是否值得继续回看。"
    },
    {
      title: "本地优先笔记应用调研",
      tags: ["知识管理", "本地软件"],
      body: "本地数据和离线可用是基础。后续可以加入全文搜索、双向链接、标签重命名以及按关联链浏览历史笔记的功能。"
    },
    {
      title: "周末跑步记录",
      tags: ["健康", "跑步"],
      body: "今晚沿河边慢跑五公里，心率稳定。明天早上拉伸，周末再补充一次间歇训练。"
    }
  ];
  state.notes = samples.map((sample, index) => ({
    id: createId(),
    ...sample,
    createdAt: now - (samples.length - index) * 1000,
    updatedAt: now - (samples.length - index) * 1000
  }));
  selectedId = state.notes[0].id;
  trail = [selectedId];
  persist();
  render();
}

function commitPendingBeforeSwitch() {
  const note = selectedNote();
  if (note && draftId === note.id) {
    window.clearTimeout(saveTimer);
    flushDraft();
  }
  window.clearTimeout(saveTimer);
  draftId = null;
}

elements.newNoteBtn.addEventListener("click", () => {
  commitPendingBeforeSwitch();
  startNewNote();
});
elements.deleteBtn.addEventListener("click", () => {
  const note = selectedNote();
  if (note && window.confirm(`确定删除「${displayTitle(note)}」吗？此工具只保留当前浏览器中的本地数据。`)) {
    deleteSelected();
  }
});
elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  window.clearTimeout(saveTimer);
  flushDraft();
  elements.saveStatus.textContent = "已保存，关联结果已按当前内容重新计算。";
});
[elements.titleInput, elements.tagsInput, elements.bodyInput].forEach((field) => {
  field.addEventListener("input", scheduleSave);
});
elements.noteList.addEventListener("click", (event) => {
  const sampleButton = event.target.closest('[data-action="sample"]');
  if (sampleButton) {
    loadSampleNotes();
    return;
  }
  const item = event.target.closest("[data-id]");
  if (!item || item.dataset.id === selectedId) return;
  commitPendingBeforeSwitch();
  selectNote(item.dataset.id);
});
elements.relatedList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-jump]");
  if (!card) return;
  commitPendingBeforeSwitch();
  selectNote(card.dataset.jump, { fromRelated: true });
});
elements.trailNav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-trail-index]");
  if (!button) return;
  const index = Number(button.dataset.trailIndex);
  commitPendingBeforeSwitch();
  selectNote(trail[index], { trailIndex: index });
});
elements.searchInput.addEventListener("input", renderNoteList);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    window.clearTimeout(saveTimer);
    flushDraft();
  }
});

render();
