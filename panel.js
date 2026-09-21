/* panel.js - sidebar panels: part/annotation lists and editors. */
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const sel = { partId: null, annId: null };
  let editorKey = '';

  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.display = 'none'; }, ms || 2600);
  }

  function vecRows(container, title, prefix, vec, onChange) {
    const h = document.createElement('div');
    h.className = 'hint'; h.textContent = title;
    container.appendChild(h);
    const row = document.createElement('div');
    row.className = 'row';
    ['x', 'y', 'z'].forEach((ax) => {
      const input = document.createElement('input');
      input.type = 'number'; input.step = '0.1'; input.value = (+vec[ax]).toFixed(2);
      input.title = prefix + '.' + ax;
      input.addEventListener('input', () => onChange(prefix, ax, parseFloat(input.value)));
      row.appendChild(input);
    });
    container.appendChild(row);
  }

  function annReason(a) {
    return a.invalidReason === 'missing-part' ? '⚠ 部件已删除' : '⚠ 锚点越界';
  }

  function rebuildLists() {
    const S = root.Scene;
    const pl = $('partList');
    pl.innerHTML = '';
    for (const p of S.state.parts) {
      const d = document.createElement('div');
      d.className = 'list-item' + (p.id === sel.partId ? ' selected' : '');
      d.textContent = p.name + ' (' + p.id + ')';
      d.addEventListener('click', () => { sel.partId = p.id; sel.annId = null; refresh(); });
      pl.appendChild(d);
    }
    const al = $('annList');
    al.innerHTML = '';
    for (const a of S.state.annotations) {
      const d = document.createElement('div');
      d.className = 'list-item' + (a.id === sel.annId ? ' selected' : '');
      const name = document.createElement('span');
      name.textContent = a.text + ' → ' + a.partId;
      d.appendChild(name);
      if (!a.valid) {
        const bad = document.createElement('span');
        bad.className = 'bad';
        bad.textContent = annReason(a);
        d.appendChild(bad);
      }
      d.addEventListener('click', () => { sel.annId = a.id; sel.partId = null; refresh(); });
      al.appendChild(d);
    }
  }

  function refresh() {
    editorKey = '';
    rebuildLists();
    refreshEditors();
  }

  // Light refresh: lists only, keep editor inputs untouched (avoids focus loss).
  function refreshListsOnly() { rebuildLists(); }

  function refreshEditors() {
    const S = root.Scene;
    const key = 'P:' + (sel.partId || '') + '|A:' + (sel.annId || '');
    if (key === editorKey) return;
    editorKey = key;
    const pe = $('partEditor'); pe.innerHTML = '';
    const ae = $('annEditor'); ae.innerHTML = '';
    const part = sel.partId && S.findPart(sel.partId);
    if (part) {
      vecRows(pe, '位置 (世界)', 'pos', part.pos, applyPart);
      vecRows(pe, '旋转 (度)', 'rot', part.rot, applyPart);
      vecRows(pe, '尺寸', 'size', part.size, applyPart);
      vecRows(pe, '缩放', 'scale', part.scale, applyPart);
      const del = document.createElement('button');
      del.className = 'danger'; del.textContent = '删除部件';
      del.addEventListener('click', () => {
        const n = S.state.annotations.filter((a) => a.partId === part.id).length;
        S.deletePart(part.id);
        sel.partId = null;
        if (n > 0) toast(n + ' 个标注因部件删除而失效');
        refresh();
      });
      pe.appendChild(del);
    }
    const ann = sel.annId && S.state.annotations.find((a) => a.id === sel.annId);
    if (ann) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<label>文字</label>';
      const txt = document.createElement('input');
      txt.type = 'text'; txt.value = ann.text;
      txt.addEventListener('input', () => {
        S.updateAnnotation(ann.id, { text: txt.value });
        if (root.App) root.App.refreshLabel(ann.id); // only this label updates
      });
      row.appendChild(txt);
      ae.appendChild(row);
      vecRows(ae, '标签偏移 (像素)', 'offset', ann.offset, (p, ax, v) => {
        if (!isFinite(v)) return;
        ann.offset[ax] = v;
        if (root.App) root.App.refreshLabel(ann.id);
      });
      const del = document.createElement('button');
      del.className = 'danger'; del.textContent = '删除标注';
      del.addEventListener('click', () => {
        S.deleteAnnotation(ann.id);
        sel.annId = null;
        if (root.App) root.App.removeLabel(ann.id);
        refresh();
      });
      ae.appendChild(del);
    }
  }

  function applyPart(prefix, axis, v) {
    if (!isFinite(v) || !sel.partId) return;
    const t = {};
    t[prefix] = {}; t[prefix][axis] = v;
    root.Scene.setPartTransform(sel.partId, t);
    refreshListsOnly();
  }

  root.Panel = { sel, refresh, refreshListsOnly, toast };
})(typeof self !== 'undefined' ? self : this);
