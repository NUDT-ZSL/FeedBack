/* Canvas map drawing methods, mixed into MapView.prototype. */
"use strict";

Object.assign(MapView.prototype, {
  draw() {
    this.resize();
    const ctx = this.ctx, w = this.cv.width, h = this.cv.height;
    ctx.clearRect(0, 0, w, h);
    this._grid();
    if (!this.data) return;
    const segs = this.data.segments, pts = this.data.points;
    for (const s of segs) if (s.type === "move") this._poly(pts, s, COLORS.move);
    for (const s of segs) if (s.type === "uncertain") this._uncertain(pts, s);
    for (const s of segs) if (s.type === "stop") this._stop(s);
    for (const d of this.data.drift) this._drift(d);
    const sel = segs.find(s => s.id === this.selectedId);
    if (sel) this._highlight(pts, sel);
  },

  _grid() {
    const ctx = this.ctx, w = this.cv.width, h = this.cv.height;
    const stepDeg = this._niceStep();
    const [nwLat, nwLon] = this.unproject(0, 0);
    const [seLat, seLon] = this.unproject(w, h);
    ctx.strokeStyle = "#dde3ea"; ctx.fillStyle = "#94a3b8";
    ctx.lineWidth = 1; ctx.font = `${11 * devicePixelRatio}px sans-serif`;
    for (let lon = Math.ceil(nwLon / stepDeg) * stepDeg; lon <= seLon; lon += stepDeg) {
      const [x] = this.project(nwLat, lon);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.fillText(lon.toFixed(4), x + 3, h - 5 * devicePixelRatio);
    }
    for (let lat = Math.ceil(seLat / stepDeg) * stepDeg; lat <= nwLat; lat += stepDeg) {
      const [, y] = this.project(lat, nwLon);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillText(lat.toFixed(4), 4, y - 3);
    }
  },

  _niceStep() {
    const span = 1 / this.view.scale * 120 * devicePixelRatio;
    const steps = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.5, 1];
    return steps.find(s => s >= span) || 5;
  },

  _poly(pts, seg, color, dash) {
    const ctx = this.ctx;
    ctx.strokeStyle = color; ctx.lineWidth = 3 * devicePixelRatio;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    for (let i = seg.start_idx; i <= seg.end_idx; i++) {
      const [x, y] = this.project(pts[i].lat, pts[i].lon);
      i === seg.start_idx ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = color;
    for (let i = seg.start_idx; i <= seg.end_idx; i++) {
      const [x, y] = this.project(pts[i].lat, pts[i].lon);
      ctx.beginPath(); ctx.arc(x, y, 2.5 * devicePixelRatio, 0, 7); ctx.fill();
    }
  },

  _stop(seg) {
    const ctx = this.ctx, [x, y] = this.project(seg.center.lat, seg.center.lon);
    const r = Math.max(this.mToPx(seg.range_m), 8 * devicePixelRatio);
    ctx.fillStyle = "rgba(37,99,235,.15)";
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = COLORS.stop; ctx.lineWidth = 2 * devicePixelRatio;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
    const pts = this.data.points;
    ctx.fillStyle = COLORS.stop;
    for (let i = seg.start_idx; i <= seg.end_idx; i++) {
      const [px, py] = this.project(pts[i].lat, pts[i].lon);
      ctx.beginPath(); ctx.arc(px, py, 2.5 * devicePixelRatio, 0, 7); ctx.fill();
    }
  },

  _uncertain(pts, seg) {
    this._poly(pts, seg, COLORS.uncertain, [8 * devicePixelRatio, 6 * devicePixelRatio]);
    const ctx = this.ctx;
    const [x, y] = this.project(seg.center.lat, seg.center.lon);
    ctx.fillStyle = COLORS.uncertain;
    ctx.font = `bold ${14 * devicePixelRatio}px sans-serif`;
    ctx.fillText("?", x - 4 * devicePixelRatio, y - 8 * devicePixelRatio);
  },

  _drift(d) {
    const ctx = this.ctx, [x, y] = this.project(d.lat, d.lon);
    const r = 5 * devicePixelRatio;
    ctx.strokeStyle = COLORS.drift; ctx.lineWidth = 2 * devicePixelRatio;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
    ctx.stroke();
  },

  _highlight(pts, seg) {
    const ctx = this.ctx;
    ctx.strokeStyle = "#facc15"; ctx.lineWidth = 6 * devicePixelRatio;
    ctx.globalAlpha = 0.6;
    if (seg.type === "stop") {
      const [x, y] = this.project(seg.center.lat, seg.center.lon);
      const r = Math.max(this.mToPx(seg.range_m), 8 * devicePixelRatio) + 4;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
    } else {
      ctx.beginPath();
      for (let i = seg.start_idx; i <= seg.end_idx; i++) {
        const [x, y] = this.project(pts[i].lat, pts[i].lon);
        i === seg.start_idx ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
});
