/* Canvas map core: projection, view control, hit test. Drawing in mapdraw.js. */
"use strict";

const COLORS = { stop: "#2563eb", move: "#16a34a", uncertain: "#ea580c",
                 drift: "#dc2626" };

class MapView {
  constructor(canvas, onSelect) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.onSelect = onSelect;
    this.data = null;
    this.selectedId = null;
    this.view = { clat: 31.23, clon: 121.47, scale: 4000 }; // px per degree
    this._bind();
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  setData(data) { this.data = data; this.draw(); }
  setSelected(id) { this.selectedId = id; this.draw(); }

  resize() {
    const r = this.cv.getBoundingClientRect();
    this.cv.width = r.width * devicePixelRatio;
    this.cv.height = r.height * devicePixelRatio;
  }

  project(lat, lon) {
    const v = this.view, w = this.cv.width, h = this.cv.height;
    return [ (lon - v.clon) * v.scale * Math.cos(v.clat * Math.PI / 180) + w / 2,
             (v.clat - lat) * v.scale + h / 2 ];
  }
  unproject(x, y) {
    const v = this.view, w = this.cv.width, h = this.cv.height;
    return [ v.clat - (y - h / 2) / v.scale,
             v.clon + (x - w / 2) / (v.scale * Math.cos(v.clat * Math.PI / 180)) ];
  }
  mToPx(m) { return m / 111320 * this.view.scale * devicePixelRatio; }

  fitTo(items) {
    if (!items.length) return;
    let a = 90, b = -90, c = 180, d = -180;
    for (const p of items) {
      a = Math.min(a, p.lat); b = Math.max(b, p.lat);
      c = Math.min(c, p.lon); d = Math.max(d, p.lon);
    }
    this.resize();
    const w = this.cv.width, h = this.cv.height;
    const cos = Math.cos((a + b) / 2 * Math.PI / 180);
    const sx = w * 0.8 / Math.max((d - c) * cos, 1e-9);
    const sy = h * 0.8 / Math.max(b - a, 1e-9);
    this.view.scale = Math.min(sx, sy, 400000 * devicePixelRatio);
    this.view.clat = (a + b) / 2;
    this.view.clon = (c + d) / 2;
    this.draw();
  }

  fitAll() {
    if (this.data) this.fitTo(this.data.points.concat(this.data.drift));
  }

  fitSegment(seg) {
    const pts = this.data.points.slice(seg.start_idx, seg.end_idx + 1);
    this.fitTo(pts.length ? pts : [seg.center]);
  }

  hitTest(mx, my) {
    if (!this.data) return null;
    const x = mx * devicePixelRatio, y = my * devicePixelRatio;
    const pts = this.data.points, segs = this.data.segments;
    for (let k = segs.length - 1; k >= 0; k--) {
      const s = segs[k];
      if (s.type === "stop") {
        const [cx, cy] = this.project(s.center.lat, s.center.lon);
        const r = Math.max(this.mToPx(s.range_m), 10 * devicePixelRatio);
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) return s.id;
      } else {
        for (let i = s.start_idx; i < s.end_idx; i++) {
          const [ax, ay] = this.project(pts[i].lat, pts[i].lon);
          const [bx, by] = this.project(pts[i + 1].lat, pts[i + 1].lon);
          if (this._segDist(x, y, ax, ay, bx, by) < 8 * devicePixelRatio)
            return s.id;
        }
      }
    }
    return null;
  }

  _segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    let t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  _bind() {
    let drag = null, moved = false;
    this.cv.addEventListener("mousedown", e => {
      drag = { x: e.offsetX, y: e.offsetY }; moved = false;
    });
    addEventListener("mousemove", e => {
      if (!drag) return;
      const dx = e.movementX * devicePixelRatio, dy = e.movementY * devicePixelRatio;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      const v = this.view;
      v.clon -= dx / (v.scale * Math.cos(v.clat * Math.PI / 180));
      v.clat += dy / v.scale;
      this.draw();
    });
    addEventListener("mouseup", e => {
      if (drag && !moved && e.target === this.cv) {
        const id = this.hitTest(e.offsetX, e.offsetY);
        if (id !== null) this.onSelect(id);
      }
      drag = null;
    });
    this.cv.addEventListener("wheel", e => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const [lat, lon] = this.unproject(e.offsetX * devicePixelRatio,
                                        e.offsetY * devicePixelRatio);
      this.view.scale = Math.min(Math.max(this.view.scale * f, 50), 5e7);
      const v = this.view, w = this.cv.width, h = this.cv.height;
      v.clon = lon - (e.offsetX * devicePixelRatio - w / 2) /
                     (v.scale * Math.cos(v.clat * Math.PI / 180));
      v.clat = lat + (e.offsetY * devicePixelRatio - h / 2) / v.scale;
      this.draw();
    }, { passive: false });
  }
}
