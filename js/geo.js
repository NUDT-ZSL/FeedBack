// 几何与坐标工具：内部统一使用局部平面坐标（米）。
(function (root) {
  const R = 6371000;

  // 经纬度 -> 以 ref 为原点的局部平面米坐标（等距圆柱近似，适合小范围）
  function toMeters(lat, lon, refLat, refLon) {
    const x = (lon - refLon) * Math.PI / 180 * R * Math.cos(refLat * Math.PI / 180);
    const y = (lat - refLat) * Math.PI / 180 * R;
    return { x, y };
  }

  function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // 射线法判断点是否在多边形内（边界上视为在内）
  function pointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      if (onSegment(p, { x: xi, y: yi }, { x: xj, y: yj })) return true;
      const intersect = ((yi > p.y) !== (yj > p.y)) &&
        (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function onSegment(p, a, b) {
    const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
    if (Math.abs(cross) > 1e-6 * Math.max(1, dist(a, b))) return false;
    const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
    if (dot < 0) return false;
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    return dot <= len2;
  }

  function centroid(poly) {
    let x = 0, y = 0;
    for (const pt of poly) { x += pt[0]; y += pt[1]; }
    return { x: x / poly.length, y: y / poly.length };
  }

  // 解析时间：支持 ISO 字符串、 epoch 秒/毫秒
  function parseTime(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number" && isFinite(v)) {
      return v > 1e12 ? v / 1000 : v; // 归一化为秒
    }
    const s = String(v).trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) {
      const n = parseFloat(s);
      return n > 1e12 ? n / 1000 : n;
    }
    const t = Date.parse(s);
    return isNaN(t) ? null : t / 1000;
  }

  function fmtTime(sec) {
    const d = new Date(sec * 1000);
    const p = n => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  const Geo = { toMeters, dist, pointInPolygon, centroid, parseTime, fmtTime };
  if (typeof module !== "undefined" && module.exports) module.exports = Geo;
  root.Geo = Geo;
})(typeof window !== "undefined" ? window : globalThis);
