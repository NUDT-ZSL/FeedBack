// Canvas 地图视图：世界坐标为米，支持平移缩放、多边形绘制与顶点编辑。
window.MapView = (function () {
  function create(canvas, opts) {
    const ctx = canvas.getContext("2d");
    const view = {
      canvas, ctx,
      cam: { x: 0, y: 0, scale: 1 },   // scale: 像素/米
      mode: "edit",                     // edit | draw | pan
      fences: [], points: [], events: [],
      selectedFenceId: null,
      highlight: null,                  // {x,y} 事件触发位置
      draft: [],                        // 正在绘制的顶点
      onChange: opts.onChange || function () {},
      onSelect: opts.onSelect || function () {},
      onDraftDone: opts.onDraftDone || function () {}
    };

    function resize() {
      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
    }
    window.addEventListener("resize", () => { resize(); render(); });
    resize();

    const toScreen = p => ({
      x: (p.x - view.cam.x) * view.cam.scale * devicePixelRatio + canvas.width / 2,
      y: canvas.height / 2 - (p.y - view.cam.y) * view.cam.scale * devicePixelRatio
    });
    const toWorld = (sx, sy) => ({
      x: (sx * devicePixelRatio - canvas.width / 2) / (view.cam.scale * devicePixelRatio) + view.cam.x,
      y: (canvas.height / 2 - sy * devicePixelRatio) / (view.cam.scale * devicePixelRatio) + view.cam.y
    });

    function grid() {
      const step = Math.pow(10, Math.ceil(Math.log10(60 / view.cam.scale)));
      ctx.strokeStyle = "#1d2432"; ctx.lineWidth = 1;
      const tl = toWorld(0, 0), br = toWorld(canvas.clientWidth, canvas.clientHeight);
      ctx.beginPath();
      for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
        const s = toScreen({ x, y: 0 });
        ctx.moveTo(s.x, 0); ctx.lineTo(s.x, canvas.height);
      }
      for (let y = Math.floor(br.y / step) * step; y <= tl.y; y += step) {
        const s = toScreen({ x: 0, y });
        ctx.moveTo(0, s.y); ctx.lineTo(canvas.width, s.y);
      }
      ctx.stroke();
      ctx.fillStyle = "#4a5878"; ctx.font = `${11 * devicePixelRatio}px Consolas`;
      for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
        const s = toScreen({ x, y: 0 });
        ctx.fillText(`${Math.round(x)}m`, s.x + 3, canvas.height - 6 * devicePixelRatio);
      }
    }

    function drawFence(f) {
      if (f.polygon.length < 2) return;
      ctx.beginPath();
      f.polygon.forEach((pt, i) => {
        const s = toScreen({ x: pt[0], y: pt[1] });
        i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y);
      });
      ctx.closePath();
      const sel = f.id === view.selectedFenceId;
      ctx.fillStyle = f.color + (sel ? "44" : "26");
      ctx.strokeStyle = f.color; ctx.lineWidth = (sel ? 2.5 : 1.5) * devicePixelRatio;
      ctx.fill(); ctx.stroke();
      const c = toScreen(Geo.centroid(f.polygon));
      ctx.fillStyle = f.color; ctx.font = `${12 * devicePixelRatio}px sans-serif`;
      ctx.fillText(`${f.name} (P${f.priority})`, c.x, c.y);
      if (sel) {
        for (const pt of f.polygon) {
          const s = toScreen({ x: pt[0], y: pt[1] });
          ctx.beginPath(); ctx.arc(s.x, s.y, 5 * devicePixelRatio, 0, 7);
          ctx.fillStyle = "#fff"; ctx.fill();
          ctx.strokeStyle = f.color; ctx.lineWidth = 2 * devicePixelRatio; ctx.stroke();
        }
      }
    }

    function render() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      grid();
      for (const f of view.fences) drawFence(f);
      // 轨迹
      if (view.points.length) {
        ctx.beginPath();
        view.points.forEach((p, i) => {
          const s = toScreen(p);
          i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y);
        });
        ctx.strokeStyle = "#8fb3ff"; ctx.lineWidth = 1.5 * devicePixelRatio; ctx.stroke();
        view.points.forEach((p, i) => {
          const s = toScreen(p);
          ctx.beginPath(); ctx.arc(s.x, s.y, 3 * devicePixelRatio, 0, 7);
          ctx.fillStyle = "#8fb3ff"; ctx.fill();
          if (i === 0) {
            ctx.beginPath(); ctx.arc(s.x, s.y, 6 * devicePixelRatio, 0, 7);
            ctx.strokeStyle = "#2fbf71"; ctx.lineWidth = 2 * devicePixelRatio; ctx.stroke();
          }
        });
      }
      // 事件标记
      const colors = { enter: "#2fbf71", exit: "#e0533d", dwell: "#e0b45c", overspeed: "#c44fe0" };
      for (const ev of view.events) {
        const s = toScreen(ev);
        ctx.beginPath(); ctx.arc(s.x, s.y, 6 * devicePixelRatio, 0, 7);
        ctx.fillStyle = colors[ev.type] || "#fff"; ctx.fill();
        ctx.fillStyle = "#0d1117"; ctx.font = `bold ${9 * devicePixelRatio}px sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(ev.typeLabel[0], s.x, s.y);
        ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
      }
      if (view.highlight) {
        const s = toScreen(view.highlight);
        ctx.beginPath(); ctx.arc(s.x, s.y, 12 * devicePixelRatio, 0, 7);
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5 * devicePixelRatio; ctx.stroke();
      }
      // 绘制中的多边形
      if (view.draft.length) {
        ctx.beginPath();
        view.draft.forEach((pt, i) => {
          const s = toScreen({ x: pt[0], y: pt[1] });
          i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y);
        });
        ctx.strokeStyle = "#e0b45c"; ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.5 * devicePixelRatio; ctx.stroke(); ctx.setLineDash([]);
        for (const pt of view.draft) {
          const s = toScreen({ x: pt[0], y: pt[1] });
          ctx.beginPath(); ctx.arc(s.x, s.y, 4 * devicePixelRatio, 0, 7);
          ctx.fillStyle = "#e0b45c"; ctx.fill();
        }
      }
    }

    // ---- 交互 ----
    let drag = null; // {kind:'pan'} | {kind:'vertex',fence,idx}
    function evtPos(e) {
      const r = canvas.getBoundingClientRect();
      return { sx: e.clientX - r.left, sy: e.clientY - r.top };
    }
    function hitVertex(w) {
      const f = view.fences.find(f => f.id === view.selectedFenceId);
      if (!f) return null;
      for (let i = 0; i < f.polygon.length; i++) {
        if (Geo.dist(w, { x: f.polygon[i][0], y: f.polygon[i][1] }) < 8 / view.cam.scale) {
          return { fence: f, idx: i };
        }
      }
      return null;
    }
    function hitFence(w) {
      for (let i = view.fences.length - 1; i >= 0; i--) {
        if (view.fences[i].polygon.length >= 3 &&
            Geo.pointInPolygon(w, view.fences[i].polygon)) return view.fences[i];
      }
      return null;
    }

    canvas.addEventListener("mousedown", e => {
      const { sx, sy } = evtPos(e);
      const w = toWorld(sx, sy);
      if (view.mode === "draw") {
        view.draft.push([w.x, w.y]); render(); return;
      }
      if (view.mode === "pan") { drag = { kind: "pan", sx, sy }; return; }
      const v = hitVertex(w);
      if (v) { drag = { kind: "vertex", fence: v.fence, idx: v.idx }; return; }
      const f = hitFence(w);
      if (f) {
        view.selectedFenceId = f.id; view.onSelect(f); render(); return;
      }
      view.selectedFenceId = null; view.onSelect(null);
      drag = { kind: "pan", sx, sy };
    });
    canvas.addEventListener("mousemove", e => {
      if (!drag) return;
      const { sx, sy } = evtPos(e);
      if (drag.kind === "pan") {
        view.cam.x -= (sx - drag.sx) / view.cam.scale;
        view.cam.y += (sy - drag.sy) / view.cam.scale;
        drag.sx = sx; drag.sy = sy;
      } else if (drag.kind === "vertex") {
        const w = toWorld(sx, sy);
        drag.fence.polygon[drag.idx] = [w.x, w.y];
      }
      render();
    });
    window.addEventListener("mouseup", () => {
      if (drag && drag.kind === "vertex") view.onChange();
      drag = null;
    });
    canvas.addEventListener("dblclick", () => {
      if (view.mode === "draw" && view.draft.length >= 3) {
        view.onDraftDone(view.draft); view.draft = []; render();
      }
    });
    canvas.addEventListener("contextmenu", e => {
      e.preventDefault();
      if (view.mode !== "edit") return;
      const { sx, sy } = evtPos(e);
      const v = hitVertex(toWorld(sx, sy));
      if (v && v.fence.polygon.length > 3) {
        v.fence.polygon.splice(v.idx, 1);
        view.onChange(); render();
      }
    });
    canvas.addEventListener("wheel", e => {
      e.preventDefault();
      const { sx, sy } = evtPos(e);
      const before = toWorld(sx, sy);
      view.cam.scale *= e.deltaY < 0 ? 1.15 : 1 / 1.15;
      view.cam.scale = Math.min(50, Math.max(0.01, view.cam.scale));
      const after = toWorld(sx, sy);
      view.cam.x += before.x - after.x;
      view.cam.y += before.y - after.y;
      render();
    }, { passive: false });
    window.addEventListener("keydown", e => {
      if (e.key === "Enter" && view.mode === "draw" && view.draft.length >= 3) {
        view.onDraftDone(view.draft); view.draft = []; render();
      }
      if (e.key === "Escape") { view.draft = []; render(); }
    });

    view.render = render;
    view.fit = function () {
      const xs = [], ys = [];
      for (const f of view.fences) for (const p of f.polygon) { xs.push(p[0]); ys.push(p[1]); }
      for (const p of view.points) { xs.push(p.x); ys.push(p.y); }
      if (!xs.length) return;
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      view.cam.x = (minX + maxX) / 2; view.cam.y = (minY + maxY) / 2;
      const w = Math.max(50, maxX - minX), h = Math.max(50, maxY - minY);
      view.cam.scale = Math.min(canvas.clientWidth / w, canvas.clientHeight / h) * 0.8;
      render();
    };
    return view;
  }
  return { create };
})();
