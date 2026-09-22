(function () {
  "use strict";
  const DP = window.DemoPlanner;

  function shade(hex, percent) {
    const n = parseInt((hex || "#60a5fa").replace("#", ""), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const t = percent < 0 ? 0 : 255;
    const p = Math.abs(percent) / 100;
    const v = (x) => Math.round((t - x) * p + x).toString(16).padStart(2, "0");
    return `#${v(r)}${v(g)}${v(b)}`;
  }

  function pointsToString(points) {
    return points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  }

  function renderIsometric(bin, selectedId, onSelect) {
    const maxDim = Math.max(bin.l, bin.w, bin.h);
    const ux = 11 / Math.max(1, maxDim / 80);
    const uy = 5.5 / Math.max(1, maxDim / 80);
    const uz = 17 / Math.max(1, maxDim / 80);
    const origin = { x: 90, y: 350 };
    const project = (x, y, z) => ({
      x: origin.x + x * ux - y * uy,
      y: origin.y + x * uy + y * ux - z * uz
    });
    const floor = [project(0,0,0), project(bin.l,0,0), project(bin.l,bin.w,0), project(0,bin.w,0)];
    const wallBack = [project(bin.l,0,0), project(bin.l,bin.w,0), project(bin.l,bin.w,bin.h), project(bin.l,0,bin.h)];
    const wallSide = [project(0,bin.w,0), project(bin.l,bin.w,0), project(bin.l,bin.w,bin.h), project(0,bin.w,bin.h)];
    const topEdges = [project(0,0,bin.h), project(bin.l,0,bin.h), project(bin.l,bin.w,bin.h), project(0,bin.w,bin.h)];

    const faces = [];
    bin.placements.forEach((p) => {
      const A = project(p.x,p.y,p.z+p.h), B = project(p.x+p.l,p.y,p.z+p.h);
      const C = project(p.x+p.l,p.y+p.w,p.z+p.h), D = project(p.x,p.y+p.w,p.z+p.h);
      const E = project(p.x,p.y,p.z), F = project(p.x+p.l,p.y,p.z);
      const G = project(p.x+p.l,p.y+p.w,p.z), H = project(p.x,p.y+p.w,p.z);
      const common = { id:p.id, name:p.name };
      faces.push({ ...common, depth:p.x+p.y-p.z, pts:[A,B,F,E], fill:shade(p.color,-12), side:"left" });
      faces.push({ ...common, depth:p.x+p.y-p.z+0.01, pts:[D,C,G,H], fill:shade(p.color,12), side:"right" });
      faces.push({ ...common, depth:p.x+p.y-p.z, pts:[A,B,C,D], fill:p.color, side:"top",
        label:project(p.x+p.l/2,p.y+p.w/2,p.z+p.h) });
    });
    faces.sort((a,b) => a.depth - b.depth || (a.side === "top" ? 1 : 0));

    const svg = [`<svg viewBox="0 0 560 430" role="img" aria-label="${bin.name}三维摆放图">`,
      `<polygon points="${pointsToString(floor)}" fill="#e2e8f0" stroke="#94a3b8"/>`,
      `<polygon points="${pointsToString(wallBack)}" fill="rgba(148,163,184,.10)" stroke="#94a3b8"/>`,
      `<polygon points="${pointsToString(wallSide)}" fill="rgba(148,163,184,.14)" stroke="#94a3b8"/>`,
      `<polygon points="${pointsToString(topEdges)}" fill="none" stroke="#94a3b8" stroke-dasharray="4 3"/>`];
    faces.forEach(f => {
      const cls = `box-face ${selectedId === f.id ? "selected" : ""}`;
      svg.push(`<polygon class="${cls}" data-id="${f.id}" points="${pointsToString(f.pts)}" fill="${f.fill}"/>`);
      if (f.side === "top") {
        svg.push(`<text x="${f.label.x}" y="${f.label.y+3}" text-anchor="middle" font-size="10" fill="#fff" pointer-events="none">${f.name}</text>`);
      }
    });
    svg.push(`<text x="18" y="410">容器内尺寸：${bin.l} × ${bin.w} × ${bin.h}，单位沿用导入数据（示例为 cm/kg）</text></svg>`);
    svg.join("");
    setTimeout(() => {
      document.querySelectorAll(".box-face").forEach(el => {
        el.addEventListener("click", () => onSelect(el.dataset.id));
      });
    }, 0);
    return svg.join("");
  }

  DP.renderIsometric = renderIsometric;
})();
