/* app.js — 画布渲染 + 指针交互状态机 */
(function () {
  'use strict';
  const M = window.AnnoModel;
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');

  const state = M.createState();
  const view = { scale: 1, ox: 0, oy: 0 };
  const HANDLE_SCREEN_TOL = 8;

  // gesture 在 pointerdown 时由 decideGesture 一次性决定并锁定，
  // 整个手势期间不再重新判定（满足"框选开始后进入框内也不切换"）。
  let gesture = null;
  let spaceDown = false;
  let hoverCursor = 'default';

  // ---------- 坐标换算 ----------
  function toWorld(sx, sy) {
    return { x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale };
  }
  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ---------- 演示数据 ----------
  function buildDemo() {
    const plan = M.addNode(state, 60, 60, 560, 380, null, '平面图');
    const roomA = M.addNode(state, 90, 100, 240, 280, plan, '房间A');
    const roomB = M.addNode(state, 360, 100, 220, 160, plan, '房间B');
    M.addNode(state, 110, 130, 90, 70, roomA, '桌子');
    M.addNode(state, 110, 230, 70, 120, roomA, '柜子');
    M.addNode(state, 380, 120, 80, 60, roomB, '沙发');
    M.addNode(state, 700, 120, 160, 120, null, '独立标注');
    fitView();
  }

  function fitView() {
    view.scale = 1; view.ox = 20; view.oy = 20;
    render();
  }

  // ---------- 渲染 ----------
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    render();
  }

  function render() {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.scale, view.scale);

    const preview = gesture && gesture.type === 'marquee'
      ? new Set(M.marqueeHit(state, M.normalizeRect(
          gesture.startWx, gesture.startWy, gesture.curWx, gesture.curWy)))
      : null;

    drawNodes(state.rootIds, preview);
    if (gesture && gesture.type === 'marquee') drawMarquee();
    ctx.restore();
    updatePanel(preview);
  }

  function drawGrid() {
    const step = 40 * view.scale;
    if (step < 8) return;
    ctx.strokeStyle = '#2a2f3a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = view.ox % step; x < canvas.width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); }
    for (let y = view.oy % step; y < canvas.height; y += step) { ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); }
    ctx.stroke();
  }

  function drawNodes(ids, preview) {
    for (const id of ids) {
      const n = state.nodes[id];
      const selected = M.isSelected(state, id);
      const inPreview = preview && preview.has(id);
      ctx.fillStyle = selected ? 'rgba(88,166,255,0.18)'
        : inPreview ? 'rgba(63,185,80,0.16)' : 'rgba(150,160,180,0.07)';
      ctx.strokeStyle = selected ? '#58a6ff' : inPreview ? '#3fb950' : '#8b949e';
      ctx.lineWidth = (selected ? 2.5 : 1.5) / view.scale;
      ctx.fillRect(n.x, n.y, n.w, n.h);
      ctx.strokeRect(n.x, n.y, n.w, n.h);
      ctx.fillStyle = selected ? '#79b8ff' : '#9da7b3';
      ctx.font = `${12 / view.scale}px sans-serif`;
      ctx.fillText(`${n.label} [${n.id}]`, n.x + 4 / view.scale, n.y + 14 / view.scale);
      if (selected) drawHandles(n);
      drawNodes(n.children, preview);
    }
  }

  function drawHandles(n) {
    const pos = M.handlePositions(n);
    const s = 6 / view.scale;
    ctx.fillStyle = '#58a6ff';
    for (const name of M.HANDLES) {
      const [hx, hy] = pos[name];
      ctx.fillRect(hx - s / 2, hy - s / 2, s, s);
    }
  }

  function drawMarquee() {
    const r = M.normalizeRect(gesture.startWx, gesture.startWy, gesture.curWx, gesture.curWy);
    ctx.fillStyle = 'rgba(88,166,255,0.10)';
    ctx.strokeStyle = '#58a6ff';
    ctx.setLineDash([6 / view.scale, 4 / view.scale]);
    ctx.lineWidth = 1.5 / view.scale;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([]);
  }
  // ---------- 指针交互 ----------
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = canvasPos(e);
    const w = toWorld(p.x, p.y);
    const g = M.decideGesture(state, w.x, w.y, {
      panButton: e.button === 1,
      spacePan: spaceDown,
      handleTol: HANDLE_SCREEN_TOL / view.scale,
    });
    gesture = Object.assign(g, {
      pointerId: e.pointerId,
      startSx: p.x, startSy: p.y,
      lastSx: p.x, lastSy: p.y,
      startWx: w.x, startWy: w.y,
      curWx: w.x, curWy: w.y,
      shift: e.shiftKey,
    });
    if (gesture.type === 'move') {
      // 移动未选中框：先把它变成选中集（shift 则追加）
      if (gesture.shift) M.addToSelection(state, [gesture.id]);
      else M.setSelection(state, [gesture.id]);
    }
    e.preventDefault();
    render();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = canvasPos(e);
    const w = toWorld(p.x, p.y);
    if (!gesture) { updateHoverCursor(w.x, w.y); return; }

    const dx = w.x - gesture.startWx;
    const dy = w.y - gesture.startWy;
    switch (gesture.type) {
      case 'move': {
        // 用增量移动整棵子树，避免浮点累积误差
        const stepX = w.x - gesture.curWx;
        const stepY = w.y - gesture.curWy;
        M.moveSubtree(state, gesture.id, stepX, stepY);
        break;
      }
      case 'resize': {
        const stepX = w.x - gesture.curWx;
        const stepY = w.y - gesture.curWy;
        M.resizeNode(state, gesture.id, gesture.handle, stepX, stepY);
        break;
      }
      case 'pan': {
        view.ox += p.x - gesture.lastSx;
        view.oy += p.y - gesture.lastSy;
        break;
      }
      case 'marquee':
        break; // 当前角点在下面统一更新
    }
    gesture.curWx = w.x;
    gesture.curWy = w.y;
    gesture.lastSx = p.x;
    gesture.lastSy = p.y;
    render();
  });

  function endGesture(e) {
    if (!gesture) return;
    if (gesture.type === 'marquee') {
      const rect = M.normalizeRect(gesture.startWx, gesture.startWy, gesture.curWx, gesture.curWy);
      const hit = M.marqueeHit(state, rect);
      if (gesture.shift) M.addToSelection(state, hit);
      else M.setSelection(state, hit);
    }
    gesture = null;
    render();
  }
  canvas.addEventListener('pointerup', endGesture);
  canvas.addEventListener('pointercancel', () => { gesture = null; render(); });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = canvasPos(e);
    const before = toWorld(p.x, p.y);
    view.scale = Math.min(8, Math.max(0.1, view.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    view.ox = p.x - before.x * view.scale;
    view.oy = p.y - before.y * view.scale;
    render();
  }, { passive: false });

  const CURSORS = {
    nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  };
  function updateHoverCursor(wx, wy) {
    const hit = M.hitTest(state, wx, wy);
    let cursor = 'crosshair';
    if (hit) {
      const h = M.handleAt(state, hit, wx, wy, HANDLE_SCREEN_TOL / view.scale);
      cursor = h ? CURSORS[h] : (M.isSelected(state, hit) ? 'crosshair' : 'move');
    }
    if (cursor !== hoverCursor) { hoverCursor = cursor; canvas.style.cursor = cursor; }
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { spaceDown = true; canvas.style.cursor = 'grab'; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selection.length) {
      M.deleteNodes(state, state.selection.slice());
      render();
    }
    if (e.key === 'Escape') {
      if (gesture) gesture = null; else M.setSelection(state, []);
      render();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { spaceDown = false; hoverCursor = ''; }
  });

  // ---------- 侧栏面板 ----------
  const GESTURE_LABELS = {
    move: '移动', resize: '缩放', marquee: '框选', pan: '平移画布',
  };
  function updatePanel(preview) {
    const gEl = document.getElementById('gesture');
    if (gesture) {
      let t = GESTURE_LABELS[gesture.type] || gesture.type;
      if (gesture.type === 'move') t += ` → ${state.nodes[gesture.id].label}`;
      if (gesture.type === 'resize') t += ` → ${state.nodes[gesture.id].label} (${gesture.handle})`;
      gEl.textContent = t;
      gEl.className = 'gesture active g-' + gesture.type;
    } else {
      gEl.textContent = '空闲';
      gEl.className = 'gesture';
    }

    const selEl = document.getElementById('selection');
    selEl.innerHTML = '';
    if (!state.selection.length) {
      selEl.innerHTML = '<span class="dim">（空）</span>';
    } else {
      for (const id of state.selection) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = `${state.nodes[id].label} [${id}]`;
        selEl.appendChild(chip);
      }
    }

    const prevEl = document.getElementById('preview');
    if (preview && preview.size) {
      prevEl.textContent = [...preview].map((id) => state.nodes[id].label).join('、');
    } else {
      prevEl.textContent = '（无）';
    }

    const treeEl = document.getElementById('tree');
    treeEl.innerHTML = '';
    buildTree(treeEl, state.rootIds, 0, preview);

    document.getElementById('zoom').textContent = Math.round(view.scale * 100) + '%';
  }

  function buildTree(container, ids, depth, preview) {
    for (const id of ids) {
      const n = state.nodes[id];
      const row = document.createElement('div');
      row.className = 'tree-row'
        + (M.isSelected(state, id) ? ' selected' : '')
        + (preview && preview.has(id) ? ' preview' : '');
      row.style.paddingLeft = 8 + depth * 16 + 'px';
      row.textContent = `${n.label} [${id}]`;
      row.addEventListener('click', (e) => {
        if (e.shiftKey) M.addToSelection(state, [id]);
        else M.setSelection(state, [id]);
        render();
      });
      container.appendChild(row);
      buildTree(container, n.children, depth + 1, preview);
    }
  }

  // ---------- 工具栏 ----------
  document.getElementById('btn-add').addEventListener('click', () => {
    const parentId = state.selection.length === 1 ? state.selection[0] : null;
    const base = parentId ? state.nodes[parentId] : null;
    const x = base ? base.x + 30 : 80 + Math.random() * 200;
    const y = base ? base.y + 30 : 80 + Math.random() * 200;
    const id = M.addNode(state, x, y, 120, 90, parentId, '新标注');
    M.setSelection(state, [id]);
    render();
  });
  document.getElementById('btn-del').addEventListener('click', () => {
    M.deleteNodes(state, state.selection.slice());
    render();
  });
  document.getElementById('btn-fit').addEventListener('click', fitView);
  document.getElementById('btn-clear-sel').addEventListener('click', () => {
    M.setSelection(state, []);
    render();
  });

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  buildDemo();
})();