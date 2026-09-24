/* model.js — 纯逻辑层：嵌套标注框数据模型 + 手势仲裁。
   不依赖 DOM，可在 Node 下单元测试。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AnnoModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN_SIZE = 8; // 世界坐标下的最小框尺寸

  function createState() {
    return { nodes: {}, rootIds: [], selection: [], nextId: 1 };
  }

  function addNode(state, x, y, w, h, parentId, label) {
    const id = 'n' + state.nextId++;
    const node = { id, x, y, w, h, parentId: parentId || null, children: [], label: label || id };
    state.nodes[id] = node;
    if (parentId && state.nodes[parentId]) state.nodes[parentId].children.push(id);
    else { node.parentId = null; state.rootIds.push(id); }
    return id;
  }

  function subtreeIds(state, id) {
    const out = [];
    (function walk(nid) {
      out.push(nid);
      state.nodes[nid].children.forEach(walk);
    })(id);
    return out;
  }

  function deleteNodes(state, ids) {
    const all = new Set();
    ids.forEach((id) => subtreeIds(state, id).forEach((x) => all.add(x)));
    all.forEach((id) => {
      const n = state.nodes[id];
      if (!n) return;
      if (n.parentId && state.nodes[n.parentId]) {
        const p = state.nodes[n.parentId];
        p.children = p.children.filter((c) => c !== id);
      }
      delete state.nodes[id];
    });
    state.rootIds = state.rootIds.filter((id) => !all.has(id));
    state.selection = state.selection.filter((id) => !all.has(id));
  }

  function depthOf(state, id) {
    let d = 0, n = state.nodes[id];
    while (n && n.parentId) { d++; n = state.nodes[n.parentId]; }
    return d;
  }

  function moveSubtree(state, id, dx, dy) {
    subtreeIds(state, id).forEach((nid) => {
      const n = state.nodes[nid];
      n.x += dx; n.y += dy;
    });
  }

  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  function handlePositions(node) {
    const { x, y, w, h } = node;
    const cx = x + w / 2, cy = y + h / 2;
    return {
      nw: [x, y], n: [cx, y], ne: [x + w, y],
      e: [x + w, cy], se: [x + w, y + h], s: [cx, y + h],
      sw: [x, y + h], w: [x, cy],
    };
  }

  // tol 为世界坐标容差（调用方用 屏幕容差/缩放比 换算）
  function handleAt(state, id, wx, wy, tol) {
    const node = state.nodes[id];
    if (!node) return null;
    const pos = handlePositions(node);
    for (const name of HANDLES) {
      const [hx, hy] = pos[name];
      if (Math.abs(wx - hx) <= tol && Math.abs(wy - hy) <= tol) return name;
    }
    return null;
  }

  function resizeNode(state, id, handle, dx, dy) {
    const n = state.nodes[id];
    if (!n) return;
    let { x, y, w, h } = n;
    if (handle.includes('e')) w += dx;
    if (handle.includes('s')) h += dy;
    if (handle.includes('w')) { x += dx; w -= dx; }
    if (handle.includes('n')) { y += dy; h -= dy; }
    if (w < MIN_SIZE) { if (handle.includes('w')) x -= MIN_SIZE - w; w = MIN_SIZE; }
    if (h < MIN_SIZE) { if (handle.includes('n')) y -= MIN_SIZE - h; h = MIN_SIZE; }
    n.x = x; n.y = y; n.w = w; n.h = h;
  }

  function contains(node, wx, wy) {
    return wx >= node.x && wx <= node.x + node.w && wy >= node.y && wy <= node.y + node.h;
  }

  // 命中检测： deepest-first；同层时后绘制（兄弟顺序靠后）者优先。
  // 先序遍历并保留最后一个命中者即可同时满足两条规则。
  function hitTest(state, wx, wy) {
    let hit = null;
    (function walk(ids) {
      for (const id of ids) {
        const n = state.nodes[id];
        if (contains(n, wx, wy)) { hit = id; walk(n.children); }
      }
    })(state.rootIds);
    return hit;
  }

  function normalizeRect(x1, y1, x2, y2) {
    return {
      x: Math.min(x1, x2), y: Math.min(y1, y2),
      w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
    };
  }

  function rectsIntersect(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // 框选命中：返回与选框相交的所有节点 id（按层级先序，便于展示）
  function marqueeHit(state, rect) {
    const out = [];
    (function walk(ids) {
      for (const id of ids) {
        const n = state.nodes[id];
        if (rectsIntersect(n, rect)) out.push(id);
        walk(n.children);
      }
    })(state.rootIds);
    return out;
  }

  function isSelected(state, id) { return state.selection.includes(id); }

  function setSelection(state, ids) { state.selection = ids.slice(); }
  function addToSelection(state, ids) {
    ids.forEach((id) => { if (!state.selection.includes(id)) state.selection.push(id); });
  }

  /* 手势仲裁：在 pointerdown 时调用一次，结果在整个手势期间锁定。
     优先级：平移(中键/空格) > 缩放手柄 > 已选中框内部=框选 > 未选中框=移动 > 空白=框选 */
  function decideGesture(state, wx, wy, opts) {
    opts = opts || {};
    if (opts.panButton || opts.spacePan) return { type: 'pan' };
    const hitId = hitTest(state, wx, wy);
    if (hitId) {
      const handle = handleAt(state, hitId, wx, wy, opts.handleTol != null ? opts.handleTol : 8);
      if (handle) return { type: 'resize', id: hitId, handle };
      if (isSelected(state, hitId)) return { type: 'marquee' };
      return { type: 'move', id: hitId };
    }
    return { type: 'marquee' };
  }

  return {
    MIN_SIZE, HANDLES,
    createState, addNode, deleteNodes, subtreeIds, depthOf,
    moveSubtree, resizeNode, handleAt, handlePositions,
    hitTest, contains, normalizeRect, rectsIntersect, marqueeHit,
    isSelected, setSelection, addToSelection, decideGesture,
  };
});