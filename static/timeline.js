/* SVG timeline: per-target stay/move rows + co-travel lanes and bands. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const GUTTER = 90, TOP = 26, ROW_H = 26, LANE_H = 22, BOT = 8;

  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  const fmt = t => new Date(t * 1000).toTimeString().slice(0, 8);

  window.drawTimeline = function (svg, state, onSelect) {
    svg.innerHTML = "";
    const targets = Object.keys(state.segments).sort();
    const rels = state.relations;
    const width = svg.clientWidth || 900;
    const plotW = width - GUTTER - 10;
    const height = TOP + targets.length * ROW_H + rels.length * LANE_H + BOT;
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.style.height = height + "px";
    if (!targets.length) {
      el("text", { x: GUTTER, y: 40, class: "row-label" }, svg)
        .textContent = "暂无数据，请先导入位置点";
      return;
    }
    let t0 = Infinity, t1 = -Infinity;
    for (const p of state.points) { t0 = Math.min(t0, p.t); t1 = Math.max(t1, p.t); }
    if (t1 <= t0) t1 = t0 + 1;
    const X = t => GUTTER + (t - t0) / (t1 - t0) * plotW;

    // time axis
    const axis = el("g", { class: "axis" }, svg);
    const ticks = 8;
    for (let i = 0; i <= ticks; i++) {
      const t = t0 + (t1 - t0) * i / ticks, x = X(t);
      el("line", { x1: x, y1: TOP - 6, x2: x, y2: height - BOT, stroke: "#eee" }, axis);
      el("text", { x: x - 22, y: TOP - 10 }, axis).textContent = fmt(t);
    }

    const rowY = {};
    targets.forEach((tg, i) => {
      const y = TOP + i * ROW_H;
      rowY[tg] = y;
      el("text", { x: 6, y: y + ROW_H / 2 + 4, class: "row-label" }, svg).textContent = tg;
      el("rect", { x: GUTTER, y: y + 3, width: plotW, height: ROW_H - 6,
                   fill: i % 2 ? "#fafbfc" : "#f2f4f7", rx: 3 }, svg);
      for (const s of state.segments[tg]) {
        const r = el("rect", {
          x: X(s.start), y: y + 6, width: Math.max(2, X(s.end) - X(s.start)),
          height: ROW_H - 12, rx: 3, class: "seg " + s.kind,
          "data-kind": "segment", "data-target": tg, "data-id": s.id }, svg);
        el("title", {}, r).textContent =
          (s.kind === "stay" ? "停留 " : "移动 ") + fmt(s.start) + " ~ " + fmt(s.end);
      }
    });

    // co-travel bands across the two target rows + dedicated lanes
    rels.forEach((r, i) => {
      const ys = r.targets.map(t => rowY[t]).filter(v => v !== undefined);
      if (ys.length === 2) {
        const yA = Math.min(ys[0], ys[1]), yB = Math.max(ys[0], ys[1]);
        el("rect", { x: X(r.start), y: yA + 3, width: Math.max(2, X(r.end) - X(r.start)),
                     height: yB - yA + ROW_H - 6, class: "rel-band" }, svg);
      }
      const y = TOP + targets.length * ROW_H + i * LANE_H;
      el("text", { x: 6, y: y + LANE_H / 2 + 4, class: "row-label" }, svg)
        .textContent = r.targets.join(" ↔ ");
      const bar = el("rect", {
        x: X(r.start), y: y + 4, width: Math.max(2, X(r.end) - X(r.start)),
        height: LANE_H - 10, rx: 3, class: "rel " + r.kind,
        "data-kind": "relation", "data-id": r.id }, svg);
      el("title", {}, bar).textContent =
        (r.kind === "stable" ? "稳定同行 " : "偶发接近 ") + fmt(r.start) +
        " ~ " + fmt(r.end) + " 置信度 " + r.confidence;
    });

    svg.querySelectorAll("[data-kind]").forEach(n =>
      n.addEventListener("click", () =>
        onSelect(n.getAttribute("data-kind"), n.getAttribute("data-target"),
                 n.getAttribute("data-id"))));
  };
})();
