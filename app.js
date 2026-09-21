/* app.js - main loop, camera controls, surface picking, annotation labels. */
(function () {
  'use strict';
  const M3 = window.Math3D, S = window.Scene, R = window.Render, P = window.Panel;
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const labelLayer = document.getElementById('labels');
  let annotateMode = false;
  const labelEls = new Map(); // annId -> div

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    canvas.width = r.width * devicePixelRatio;
    canvas.height = r.height * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  window.addEventListener('resize', resize);

  const viewW = () => canvas.width / devicePixelRatio;
  const viewH = () => canvas.height / devicePixelRatio;

  // ---- annotation labels (DOM) ------------------------------------------
  function ensureLabel(ann) {
    let el = labelEls.get(ann.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'ann-label';
      el.addEventListener('mousedown', (e) => startLabelDrag(e, ann));
      el.addEventListener('click', () => { P.sel.annId = ann.id; P.sel.partId = null; P.refresh(); });
      labelLayer.appendChild(el);
      labelEls.set(ann.id, el);
    }
    return el;
  }

  function refreshLabel(id) {
    const ann = S.state.annotations.find((a) => a.id === id);
    if (!ann) return;
    const el = ensureLabel(ann);
    el.textContent = ann.valid ? ann.text : '⚠ ' + ann.text;
    el.classList.toggle('invalid', !ann.valid);
    el.classList.toggle('selected', P.sel.annId === id);
  }

  function removeLabel(id) {
    const el = labelEls.get(id);
    if (el) el.remove();
    labelEls.delete(id);
  }

  // Per-frame: derive screen anchor from the part->world chain, place labels.
  function syncLabels(basis) {
    const seen = new Set();
    for (const ann of S.state.annotations) {
      seen.add(ann.id);
      const el = ensureLabel(ann);
      let s = null;
      if (ann.valid && ann.world) {
        s = R.project(ann.world, basis, viewW(), viewH());
        if (s.z > 0.05) ann.lastScreen = { x: s.x, y: s.y };
      }
      const base = (s && s.z > 0.05) ? s : ann.lastScreen;
      if (!base) { el.style.display = 'none'; ann._screen = null; continue; }
      el.style.display = '';
      el.style.left = (base.x + ann.offset.x) + 'px';
      el.style.top = (base.y + ann.offset.y) + 'px';
      el.textContent = ann.valid ? ann.text : '⚠ ' + ann.text;
      el.classList.toggle('invalid', !ann.valid);
      el.classList.toggle('selected', P.sel.annId === ann.id);
      ann._screen = base;
    }
    for (const [id, el] of labelEls) {
      if (!seen.has(id)) { el.remove(); labelEls.delete(id); }
    }
  }

  // Canvas-side markers + leader lines, drawn under the DOM labels.
  function drawAnnotations() {
    for (const ann of S.state.annotations) {
      const s = ann._screen;
      if (!s) continue;
      const lx = s.x + ann.offset.x, ly = s.y + ann.offset.y;
      ctx.beginPath();
      if (ann.valid) {
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(251,191,36,0.9)';
        ctx.fillStyle = '#fbbf24';
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(lx, ly - 4);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // invalid: recognizable dashed red marker, never silently dropped
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s.x - 4, s.y - 4); ctx.lineTo(s.x + 4, s.y + 4);
        ctx.moveTo(s.x + 4, s.y - 4); ctx.lineTo(s.x - 4, s.y + 4);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
      }
    }
  }

  // ---- main loop ---------------------------------------------------------
  function frame() {
    const b = R.basis();
    R.drawScene(ctx, viewW(), viewH(), P.sel.partId);
    syncLabels(b);
    drawAnnotations();
    requestAnimationFrame(frame);
  }

  // ---- camera + mouse ----------------------------------------------------
  let drag = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    drag = { x: e.clientX, y: e.clientY, btn: e.button, shift: e.shiftKey, moved: 0 };
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.btn === 2 || drag.shift) {
      const b = R.basis();
      const k = R.camera.dist / 600;
      R.camera.target = M3.add(R.camera.target,
        M3.add(M3.mul(b.right, -dx * k), M3.mul(b.up, dy * k)));
    } else if (drag.btn === 0 && !annotateMode) {
      R.camera.theta -= dx * 0.008;
      R.camera.phi = Math.min(3.0, Math.max(0.15, R.camera.phi - dy * 0.008));
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (drag && drag.moved < 4 && drag.btn === 0 && annotateMode && e.target === canvas) {
      pickAndAnnotate(e);
    }
    drag = null;
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    R.camera.dist = Math.min(60, Math.max(2, R.camera.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
  }, { passive: false });

  // ---- surface picking ---------------------------------------------------
  function pickAndAnnotate(e) {
    const rect = canvas.getBoundingClientRect();
    const ray = R.screenRay(e.clientX - rect.left, e.clientY - rect.top, viewW(), viewH());
    let best = null;
    for (const part of S.state.parts) {
      const inv = S.partInverse(part);
      const ro = M3.transformPoint(inv, ray.origin);
      const rd = M3.transformDir(inv, ray.dir);
      const hit = M3.rayBox(ro, rd, M3.v3(part.size.x / 2, part.size.y / 2, part.size.z / 2));
      if (hit && (!best || hit.t < best.hit.t)) best = { part, hit };
    }
    if (!best) return;
    // anchor stored in the part's LOCAL frame, on its surface
    const ann = S.createAnnotation(best.part.id, best.hit.point, '标注 ' + (S.state.annotations.length + 1));
    P.sel.annId = ann.id; P.sel.partId = null;
    P.refresh();
  }

  // ---- label dragging (per-annotation 2D offset) -------------------------
  function startLabelDrag(e, ann) {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const ox = ann.offset.x, oy = ann.offset.y;
    function move(ev) {
      S.updateAnnotation(ann.id, { offset: { x: ox + ev.clientX - sx, y: oy + ev.clientY - sy } });
    }
    function up() {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      P.refreshListsOnly();
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  // ---- toolbar -----------------------------------------------------------
  document.getElementById('btnAnnotate').addEventListener('click', (e) => {
    annotateMode = !annotateMode;
    e.target.classList.toggle('active', annotateMode);
    canvas.style.cursor = annotateMode ? 'crosshair' : 'grab';
  });
  document.getElementById('btnAddPart').addEventListener('click', () => {
    const n = S.state.parts.length;
    const p = S.createPart({
      pos: { x: (n % 3 - 1) * 2.2, y: 0.5, z: (Math.floor(n / 3) % 3 - 1) * 2.2 },
      size: { x: 1 + 0.3 * (n % 2), y: 1, z: 0.8 + 0.2 * (n % 3) },
    });
    P.sel.partId = p.id; P.sel.annId = null;
    P.refresh();
  });
  document.getElementById('btnExport').addEventListener('click', () => {
    const blob = new Blob([S.serialize()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'scene.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const fileInput = document.getElementById('fileInput');
  document.getElementById('btnImport').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        S.deserialize(rd.result);
        P.sel.partId = null; P.sel.annId = null;
        P.refresh();
        P.toast('场景已导入');
      } catch (err) { P.toast('导入失败: ' + err.message); }
    };
    rd.readAsText(f);
    fileInput.value = '';
  });

  // ---- seed demo scene + start -------------------------------------------
  S.createPart({ name: '底座', pos: { x: 0, y: 0.25, z: 0 }, size: { x: 3, y: 0.5, z: 2 } });
  S.createPart({ name: '立柱', pos: { x: -0.8, y: 1.5, z: 0 }, rot: { x: 0, y: 20, z: 0 }, size: { x: 0.5, y: 2, z: 0.5 } });
  S.createPart({ name: '横梁', pos: { x: 0.4, y: 2.6, z: 0 }, rot: { x: 0, y: 20, z: 8 }, size: { x: 2.4, y: 0.3, z: 0.4 } });
  S.createAnnotation('P2', { x: 0.25, y: 0.4, z: 0.1 }, '焊缝检查点');
  S.createAnnotation('P3', { x: 0.6, y: 0.15, z: 0 }, '应力集中区');
  window.App = { refreshLabel, removeLabel };
  resize();
  P.refresh();
  frame();
})();
