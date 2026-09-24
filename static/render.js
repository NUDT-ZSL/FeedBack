/* Segment list rendering, selection and manual override. */
"use strict";

function renderSegList(segs) {
  const box = $("segList");
  box.innerHTML = "";
  segs.forEach(s => {
    const el = document.createElement("div");
    el.className = `seg ${s.type}` + (s.id === SELECTED ? " selected" : "");
    el.dataset.id = s.id;
    const manual = s.overridden ? `<span class="badge manual">人工调整</span>` : "";
    const rows = [
      ["时长", fmtDur(s.duration_s)], ["点数", s.point_count],
      ["覆盖范围", fmtDist(s.range_m * 2)],
      ["平均速度", s.avg_speed_kmh.toFixed(1) + " km/h"],
    ];
    if (s.type === "move") rows.push(["移动距离", fmtDist(s.distance_m)]);
    el.innerHTML =
      `<div class="head"><span><span class="badge ${s.type}">${TYPE_NAME[s.type]}</span>${manual}</span>` +
      `<b>${fmtTime(s.start_time)} – ${fmtTime(s.end_time)}</b></div>` +
      `<div class="meta">${rows.map(([k, v]) => `<span>${k}：${v}</span>`).join("")}</div>` +
      (s.reasons.length ? `<div class="reasons">⚠ ${s.reasons.join("；")}</div>` : "") +
      (s.warnings.length ? `<div class="warnings">提示：${s.warnings.join("；")}（已保留您的修改）</div>` : "") +
      `<div class="ops"></div>`;
    const ops = el.querySelector(".ops");
    const mk = (label, type) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = ev => { ev.stopPropagation(); override(s.id, type); };
      ops.appendChild(b);
    };
    if (s.type !== "stop") mk(s.type === "uncertain" ? "确认为停驻" : "设为停驻", "stop");
    if (s.type !== "move") mk(s.type === "uncertain" ? "确认为移动" : "设为移动", "move");
    el.onclick = () => selectSegment(s.id, true);
    box.appendChild(el);
  });
}

function selectSegment(id, fit) {
  SELECTED = id;
  mapView.setSelected(id);
  document.querySelectorAll(".seg").forEach(el =>
    el.classList.toggle("selected", +el.dataset.id === id));
  const el = document.querySelector(`.seg[data-id="${id}"]`);
  if (el) el.scrollIntoView({ block: "nearest" });
  if (fit) {
    const seg = DATA.segments.find(s => s.id === id);
    if (seg) mapView.fitSegment(seg);
  }
}

async function override(id, type) {
  try {
    const data = await api("/api/override", { segment_id: id, type });
    SELECTED = data.changed.id;
    render(data, true);
    mapView.setSelected(SELECTED);
    const w = data.changed.warnings;
    toast(w && w.length ? "已保存修改，但：" + w.join("；")
                        : `已设为「${TYPE_NAME[type]}」，相邻同类段已自动合并`,
          !!(w && w.length));
  } catch (e) { toast(e.message, true); }
}
