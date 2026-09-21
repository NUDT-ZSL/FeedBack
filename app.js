/* app.js — 界面状态与交互。关联计算全部委托给 Relations.computeRelations，
 * 每次数据变更后重新计算，不缓存旧结果。 */
(function () {
  "use strict";
  const STORAGE_KEY = "note-relations.notes.v1";

  let notes = loadNotes();
  let currentId = null;      // 当前查看的笔记
  const history = [];        // 浏览线索栈，用于回退

  function loadNotes() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveNotes() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }
  function genId() {
    return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function getNote(id) { return notes.find((n) => n.id === id) || null; }
  function parseTags(s) {
    return Relations.normalizeTags(String(s || "").split(/[,，;；]/));
  }

  const $ = (id) => document.getElementById(id);

  function renderAll() {
    const relations = Relations.computeRelations(notes);
    renderList(relations);
    renderDetail(relations);
    renderBreadcrumb();
  }

  function renderList(relations) {
    $("note-count").textContent = "（共 " + notes.length + " 条）";
    const ul = $("note-list");
    ul.innerHTML = "";
    for (const n of notes) {
      const li = document.createElement("li");
      if (n.id === currentId) li.className = "active";
      const relCount = (relations.get(n.id) || []).length;
      const title = document.createElement("div");
      title.className = "li-title";
      title.textContent = n.title;
      const meta = document.createElement("div");
      meta.className = "muted";
      meta.textContent = relCount > 0 ? ("关联 " + relCount + " 条") : "当前孤立";
      li.appendChild(title);
      li.appendChild(meta);
      li.addEventListener("click", () => selectNote(n.id, true));
      ul.appendChild(li);
    }
  }

  function renderDetail(relations) {
    const note = getNote(currentId);
    const empty = $("detail-empty"), box = $("detail");
    if (!note) {
      empty.classList.remove("hidden");
      box.classList.add("hidden");
      return;
    }
    empty.classList.add("hidden");
    box.classList.remove("hidden");
    $("d-title").textContent = note.title;
    $("d-text").textContent = note.text || "（无正文）";
    const tagRow = $("d-tags");
    tagRow.innerHTML = "";
    for (const t of note.tags) {
      const s = document.createElement("span");
      s.className = "tag";
      s.textContent = t;
      tagRow.appendChild(s);
    }
    $("e-title").value = note.title;
    $("e-tags").value = note.tags.join(", ");
    $("e-text").value = note.text || "";

    const rel = relations.get(note.id) || [];
    const box2 = $("related");
    box2.innerHTML = "";
    if (rel.length === 0) {
      const d = document.createElement("div");
      d.className = "isolated";
      d.textContent = "这条笔记当前孤立：与其他笔记既没有共同标签，也没有足够的文本线索。";
      box2.appendChild(d);
      return;
    }
    for (const r of rel) {
      const other = getNote(r.id);
      if (!other) continue;
      const card = document.createElement("div");
      card.className = "rel-card";
      const head = document.createElement("div");
      head.className = "rel-head";
      const t = document.createElement("span");
      t.className = "rel-title";
      t.textContent = other.title;
      const sc = document.createElement("span");
      sc.className = "rel-score";
      sc.textContent = "相关度 " + r.score.toFixed(2);
      head.appendChild(t); head.appendChild(sc);
      const reason = document.createElement("div");
      reason.className = "rel-reason";
      reason.textContent = "理由：" + formatReasons(r.reasons);
      card.appendChild(head);
      card.appendChild(reason);
      card.addEventListener("click", () => selectNote(r.id, true));
      box2.appendChild(card);
    }
  }
  function formatReasons(reasons) {
    const parts = [];
    if (reasons.tags.length > 0) {
      parts.push("共同标签「" + reasons.tags.join("」、「") + "」");
    }
    if (reasons.keywords.length > 0) {
      parts.push("文本线索：都提到「" + reasons.keywords.join("」、「") + "」");
    }
    return parts.length > 0 ? parts.join("；") : "（无可说明的线索）";
  }

  function renderBreadcrumb() {
    const bar = $("breadcrumb");
    if (history.length === 0) {
      bar.classList.add("hidden");
      return;
    }
    bar.classList.remove("hidden");
    const chain = history.concat([currentId])
      .map((id) => { const n = getNote(id); return n ? n.title : "（已删除）"; });
    $("crumb-path").textContent = "浏览线索：" + chain.join(" → ");
  }

  function selectNote(id, pushHistory) {
    if (!getNote(id)) return;
    if (pushHistory && currentId && currentId !== id) history.push(currentId);
    currentId = id;
    renderAll();
  }

  $("note-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const note = {
      id: genId(),
      title: $("f-title").value.trim(),
      tags: parseTags($("f-tags").value),
      text: $("f-text").value.trim(),
    };
    if (!note.title) return;
    notes.push(note);
    saveNotes();
    $("note-form").reset();
    selectNote(note.id, false); // 录入后立即出现在列表并选中
  });

  $("edit-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const note = getNote(currentId);
    if (!note) return;
    note.title = $("e-title").value.trim() || note.title;
    note.tags = parseTags($("e-tags").value);
    note.text = $("e-text").value.trim();
    saveNotes();
    renderAll(); // 重新计算关联，旧判断立即失效
  });

  $("btn-delete").addEventListener("click", () => {
    if (!currentId) return;
    if (!confirm("确定删除这条笔记吗？")) return;
    notes = notes.filter((n) => n.id !== currentId);
    for (let i = history.length - 1; i >= 0; i--) {
      if (!getNote(history[i])) history.splice(i, 1);
    }
    currentId = history.length > 0 ? history.pop() : null;
    saveNotes();
    renderAll();
  });

  $("btn-back").addEventListener("click", () => {
    if (history.length === 0) return;
    currentId = history.pop();
    renderAll();
  });

  renderAll();
})();
