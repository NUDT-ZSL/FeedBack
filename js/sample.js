(function (global) {
  "use strict";

  function buildSamplePoints() {
    const points = [];
    let n = 1;
    const add = (targetId, offsetSec, lat, lon) => {
      const t = new Date(Date.UTC(2026, 8, 22, 2, 0, offsetSec));
      points.push({
        id: "P" + String(n++).padStart(3, "0"),
        targetId,
        time: t.toISOString(),
        lat: lat.toFixed(7),
        lon: lon.toFixed(7)
      });
    };
    const jitter = (v, amount) => v + (Math.random() - 0.5) * amount;

    for (let s = 0; s <= 480; s += 60) {
      if (s < 360) {
        add("A", s, jitter(31.23040, 0.00008), jitter(121.47370, 0.00008));
        add("B", s, jitter(31.23046, 0.00008), jitter(121.47376, 0.00008));
      } else {
        const k = (s - 360) / 240;
        add("A", s, 31.23040 + k * 0.00240, 121.47370 + k * 0.00260);
        add("B", s, 31.23046 + k * 0.00240, 121.47376 + k * 0.00260);
      }
    }
    add("A", 600, 31.23310, 121.47680);
    add("B", 600, 31.23316, 121.47686);
    add("A", 601, 31.24400, 121.50500);
    add("A", 660, 31.23335, 121.47705);
    add("B", 660, 31.23341, 121.47711);
    add("C", 0, 31.23034, 121.47364);
    add("C", 120, 31.23042, 121.47372);
    add("C", 180, 31.23038, 121.47368);
    add("C", 540, 31.23255, 121.47595);

    const duplicate = Object.assign({}, points.find(p => p.targetId === "A" && p.time.endsWith("00:02:00.000Z")));
    duplicate.id = "P-DUP";
    points.splice(points.findIndex(p => p.targetId === "B") + 1, 0, duplicate);
    const late = {
      id: "P-LATE", targetId: "A", time: "2026-09-22T02:00:30.000Z",
      lat: "31.2304200", lon: "121.4737200"
    };
    points.splice(points.findIndex(p => p.targetId === "B" && p.time.endsWith("00:04:00.000Z")) + 1, 0, late);
    points.push({ id: "P-BAD-COORD", targetId: "C", time: "2026-09-22T02:08:00.000Z", lat: "999", lon: "" });
    return points;
  }

  global.MovementDemoSample = { buildSamplePoints };
})(window);
