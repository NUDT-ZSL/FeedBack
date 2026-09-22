(function () {
  "use strict";
  const DP = window.DemoPlanner;
  const $ = (id) => document.getElementById(id);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[m]));

  let raw = clone(DP.sampleData);
  let result = null;
  let recommendation = null;
  let selectedBinId = null;
  let selectedCargoId = null;
  let previousPlacement = new Map();

  function numberOr(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function readForm() {
    const containers = [...document.querySelectorAll("[data-container-id]")].map(row => ({
      id: row.dataset.containerId,
      name: row.querySelector("[data-field=name]").value.trim() || row.dataset.containerId,
      l: numberOr(row.querySelector("[data-field=l]").value),
      w: numberOr(row.querySelector("[data-field=w]").value),
      h: numberOr(row.querySelector("[data-field=h]").value),
      maxWeight: numberOr(row.querySelector("[data-field=maxWeight]").value),
      count: Math.max(0, Math.floor(numberOr(row.querySelector("[data-field=count]").value, 0)))
    }));
    const cargos = [...document.querySelectorAll("[data-cargo-id]")].map(row => ({
      id: row.dataset.cargoId,
      name: row.querySelector("[data-field=name]").value.trim() || row.dataset.cargoId,
      l: numberOr(row.querySelector("[data-field=l]").value),
      w: numberOr(row.querySelector("[data-field=w]").value),
      h: numberOr(row.querySelector("[data-field=h]").value),
      weight: numberOr(row.querySelector("[data-field=weight]").value),
      loadCapacity: numberOr(row.querySelector("[data-field=loadCapacity]").value),
      stackable: row.querySelector("[data-field=stackable]").checked,
      rotatable: row.querySelector("[data-field=rotatable]").checked,
      flippable: row.querySelector("[data-field=flippable]").checked
    }));
    const relations = [...document.querySelectorAll("[data-relation-id]")].map(row => ({
      id: row.dataset.relationId,
      a: row.querySelector("[data-field=a]").value,
      b: row.querySelector("[data-field=b]").value,
      type: row.querySelector("[data-field=type]").value
    })).filter(r => r.a && r.b && r.a !== r.b);
    raw = { containers, cargos, relations, supportRatio: numberOr($("supportRatio").value, 0.9) };
  }

  function optionList(selected) {
    return raw.cargos.map(c =>
      `<option value="${esc(c.id)}" ${c.id===selected?"selected":""}>${esc(c.name)}（${esc(c.id)}）</option>`).join("");
  }

  function cargoStatus(cargo) {
    if (!result) return "";
    const found = result.bins.flatMap(b => b.placements.map(p => [b,p])).find(([,p]) => p.id === cargo.id);
    if (!found) return previousPlacement.has(cargo.id) ? "移出" : "未安置";
    const old = previousPlacement.get(cargo.id);
    if (!old) return "新放入";
    return old === placementSignature(found[0], found[1]) ? "原位" : "换位";
  }

  function renderEditors() {
    $("containerEditor").innerHTML = raw.containers.map(b => `
      <div class="editor-row" data-container-id="${esc(b.id)}">
        <input data-field="name" value="${esc(b.name)}">
        <input data-field="l" type="number" value="${b.l}" title="长">
        <input data-field="w" type="number" value="${b.w}" title="宽">
        <input data-field="h" type="number" value="${b.h}" title="高">
        <input data-field="maxWeight" type="number" value="${b.maxWeight}" title="承重上限">
        <input data-field="count" type="number" min="0" value="${b.count}" title="数量">
        <button class="small danger" data-delete-container="${esc(b.id)}">删</button>
      </div>`).join("");
    const heads = ["ID","名称","长","宽","高","重量","可承","可堆","可旋","可翻","状态",""];
    $("cargoTable").innerHTML = `<thead><tr>${heads.map(h=>`<th>${h}</th>`).join("")}</tr></thead>
      <tbody>${raw.cargos.map(c => `<tr data-cargo-id="${esc(c.id)}">
        <td>${esc(c.id)}</td>
        <td><input data-field="name" value="${esc(c.name)}"></td>
        <td><input data-field="l" type="number" value="${c.l}"></td>
        <td><input data-field="w" type="number" value="${c.w}"></td>
        <td><input data-field="h" type="number" value="${c.h}"></td>
        <td><input data-field="weight" type="number" value="${c.weight}"></td>
        <td><input data-field="loadCapacity" type="number" value="${c.loadCapacity}"></td>
        <td><input data-field="stackable" type="checkbox" ${c.stackable?"checked":""}></td>
        <td><input data-field="rotatable" type="checkbox" ${c.rotatable?"checked":""}></td>
        <td><input data-field="flippable" type="checkbox" ${c.flippable?"checked":""}></td>
        <td class="status-${esc(cargoStatus(c))}">${esc(cargoStatus(c))}</td>
        <td><button class="small danger" data-delete-cargo="${esc(c.id)}">删</button></td>
      </tr>`).join("")}</tbody>`;
    $("relationEditor").innerHTML = raw.relations.map(r => `
      <div class="editor-row relation" data-relation-id="${esc(r.id)}">
        <select data-field="a">${optionList(r.a)}</select>
        <select data-field="b">${optionList(r.b)}</select>
        <select data-field="type">
          <option value="incompatible" ${r.type==="incompatible"?"selected":""}>不可同放</option>
          <option value="adjacent" ${r.type==="adjacent"?"selected":""}>必须相邻</option>
        </select>
        <button class="small danger" data-delete-relation="${esc(r.id)}">删</button>
      </div>`).join("");
    $("supportRatio").value = raw.supportRatio;
  }

  function placementSignature(bin, p) {
    return [bin.id, bin.l, bin.w, bin.h, bin.maxWeight,
      Math.round(p.x), Math.round(p.y), Math.round(p.z), p.orientation].join("|");
  }

  function annotateChanges() {
    result.bins.forEach(bin => bin.placements.forEach(p => {
      const old = previousPlacement.get(p.id);
      const now = placementSignature(bin, p);
      p.change = !old ? "new" : old === now ? "same" : "moved";
    }));
    result.unplaced.forEach(c => {
      c.change = previousPlacement.has(c.id) ? "removed" : "unplaced";
    });
  }

  function pct(n) { return `${(Math.max(0, Math.min(1, n)) * 100).toFixed(1)}%`; }

  function renderSummary() {
    const spaces = result.bins.map(b => DP.freeSpace(b, b.placements));
    const volume = spaces.reduce((s,x)=>s+x.volume,0);
    const usedVolume = spaces.reduce((s,x)=>s+x.usedVolume,0);
    const weight = spaces.reduce((s,x)=>s+x.usedWeight,0);
    const maxWeight = spaces.reduce((s,x)=>s+x.maxWeight,0);
    const available = result.bins.length;
    $("summary").innerHTML = [
      ["货物总数", result.data.cargos.length, `${result.unplaced.length} 件未安置`],
      ["启用容器", `${result.usedBins}/${available}`, "按实际装货容器计"],
      ["体积利用", pct(volume ? usedVolume/volume : 0), `${Math.round(usedVolume)} / ${Math.round(volume)}`],
      ["重量利用", pct(maxWeight ? weight/maxWeight : 0), `${weight.toFixed(1)} / ${maxWeight.toFixed(1)} kg`],
      ["方案状态", result.success ? "可行" : "不可行", result.success ? "全部关系与物理约束通过" : "请查看具体原因"]
    ].map(([a,b,c]) => `<div class="metric"><b>${b}</b><span>${a} · ${esc(c)}</span></div>`).join("");

    const changed = result.data.cargos.map(c => {
      const current = result.bins.flatMap(b => b.placements.map(p => [b,p])).find(([,p])=>p.id===c.id);
      const old = previousPlacement.get(c.id);
      if (!old && current) return `${c.name}：新放入`;
      if (old && !current) return `${c.name}：移出`;
      if (current && old !== placementSignature(current[0], current[1])) return `${c.name}：换位`;
      return null;
    }).filter(Boolean);
    $("conflicts").innerHTML =
      (result.success ? `<div class="alert success">已找到可行初始/调整方案：容器归属、姿态、逐层支撑与承重均校验通过。</div>` :
        result.issues.map(x => `<div class="alert error">${esc(x)}</div>`).join("")) +
      (changed.length ? `<div class="alert warning">本轮变化：${esc(changed.slice(0, 12).join("；"))}${changed.length>12?" 等":""}</div>` : "");

    recommendation = result.success ? null : DP.recommendExtraContainers(raw, result);
    $("recommend").innerHTML = recommendation ? `<div class="recommend">
      <div><strong>${esc(recommendation.message)}</strong>${recommendation.count===null?`<br>${esc((recommendation.reasons||[]).join("；"))}`:""}</div>
      ${recommendation.count ? `<button class="primary" id="applyRecommendation">应用并补箱重算</button>` : ""}
    </div>` : "";
  }

  function renderBinCards() {
    if (!selectedBinId || !result.bins.some(b => b.id === selectedBinId)) {
      selectedBinId = (result.bins.find(b => b.placements.length) || result.bins[0])?.id || null;
    }
    $("binCards").innerHTML = result.bins.map(bin => {
      const s = DP.freeSpace(bin, bin.placements);
      const v = s.volume ? s.usedVolume/s.volume : 0;
      const moved = bin.placements.filter(p => p.change === "moved").length;
      const added = bin.placements.filter(p => p.change === "new").length;
      return `<button class="bin-card ${bin.id===selectedBinId?"active":""}" data-bin-id="${esc(bin.id)}">
        <div class="bin-card-header"><span>${esc(bin.name)}</span><span>${bin.placements.length}件</span></div>
        <div class="bar"><i style="width:${pct(v)}"></i></div>
        <small>体积 ${pct(v)} · 重量 ${pct(s.maxWeight?s.usedWeight/s.maxWeight:0)} · 剩余高度 ${s.freeHeight.toFixed(0)}</small>
        ${moved || added ? `<small>换位 ${moved} 件；新放入 ${added} 件</small>` : ""}
      </button>`;
    }).join("");
  }

  function floorOpenings(bin) {
    const feet = bin.placements.filter(p => p.z <= 1e-6);
    const xs = [0, bin.l];
    const ys = [0, bin.w];
    feet.forEach(p => { xs.push(p.x, p.x+p.l); ys.push(p.y, p.y+p.w); });
    const ux = [...new Set(xs.map(Number))].sort((a,b)=>a-b);
    const uy = [...new Set(ys.map(Number))].sort((a,b)=>a-b);
    const openings = [];
    for (let i=0; i<ux.length-1; i++) for (let j=0; j<uy.length-1; j++) {
      const x = ux[i], y = uy[j], l = ux[i+1]-ux[i], w = uy[j+1]-uy[j];
      const cx = x+l/2, cy = y+w/2;
      const occupied = feet.some(p => cx>p.x-1e-6 && cx<p.x+p.l+1e-6 && cy>p.y-1e-6 && cy<p.y+p.w+1e-6);
      if (!occupied && l>1e-6 && w>1e-6) openings.push({x,y,l,w,area:l*w});
    }
    return openings.sort((a,b)=>b.area-a.area).slice(0,5);
  }

  function renderBinDetail() {
    const bin = result.bins.find(b => b.id === selectedBinId);
    if (!bin) {
      $("binDetail").innerHTML = `<h2>暂无容器</h2><p>请在左侧增加容器数量或尺寸。</p>`;
      return;
    }
    const s = DP.freeSpace(bin, bin.placements);
    const byId = DP.cargoMap(result.data.cargos);
    const analysis = DP.analyzeStack(bin.placements, byId);
    const layers = new Map();
    bin.placements.forEach(p => {
      const key = Math.round(p.z * 100) / 100;
      if (!layers.has(key)) layers.set(key, []);
      layers.get(key).push(p);
    });
    const openings = floorOpenings(bin);
    const selected = bin.placements.find(p => p.id === selectedCargoId);
    const selectedCargo = selected ? result.data.cargos.find(c => c.id === selected.id) : null;
    $("binDetail").innerHTML = `
      <div class="detail-head">
        <div><h2>${esc(bin.name)}</h2>
          <p>内尺寸 ${bin.l}×${bin.w}×${bin.h}；总承重 ${bin.maxWeight}kg；已用 ${s.usedWeight.toFixed(1)}kg</p>
        </div>
        <button class="small" data-close-detail>收起</button>
      </div>
      <div class="viz-wrap">
        <div id="viz">${DP.renderIsometric(bin, selectedCargoId, id => { selectedCargoId=id; renderBinDetail(); })}</div>
        <div>
          <div class="layer-list">
            ${[...layers.entries()].sort((a,b)=>b[0]-a[0]).map(([z,list]) => `
              <div class="layer-group">
                <h3>高度层 z=${z}（${list.length} 件）</h3>
                ${list.sort((a,b)=>a.y-b.y||a.x-b.x).map(p => {
                  const cargo = byId.get(p.id);
                  const above = analysis.load.get(p.id) || 0;
                  return `<div class="cargo-chip ${p.id===selectedCargoId?"selected":""}" data-cargo-select="${esc(p.id)}">
                    <span><i class="swatch" style="background:${p.color}"></i>${esc(p.name)}</span>
                    <span>${p.change==="moved"?"换位":p.change==="new"?"新":""} ${above.toFixed(0)}/${cargo.loadCapacity}kg</span>
                  </div>`;
                }).join("")}
              </div>`).join("") || `<div class="layer-group">空容器</div>`}
          </div>
          <div class="free-space">
            <strong>剩余空间</strong>
            <ul>
              <li>剩余容积：${Math.round(s.freeVolume)}（${pct(s.freeVolume/s.volume)}）</li>
              <li>剩余承重：${s.freeWeight.toFixed(1)}kg</li>
              <li>当前最高：${s.top.toFixed(1)}；垂直净空：${s.freeHeight.toFixed(1)}</li>
              ${openings[0] ? `<li>最大底层空位：${openings[0].l.toFixed(1)}×${openings[0].w.toFixed(1)}，起点(${openings[0].x.toFixed(1)}, ${openings[0].y.toFixed(1)})</li>` : "<li>底面已被占满，只能考虑上层。</li>"}
            </ul>
          </div>
        </div>
      </div>
      ${selected && selectedCargo ? `<div class="alert success" style="margin-top:10px">
        ${esc(selectedCargo.name)}：落点(${selected.x}, ${selected.y}, ${selected.z})，姿态 ${esc(selected.orientation)}；
        自重 ${selectedCargo.weight}kg，上方分配承重 ${(analysis.load.get(selected.id)||0).toFixed(1)}kg / 可承 ${selectedCargo.loadCapacity}kg。
      </div>` : `<p class="free-space">点击三维箱体或右侧货名可查看姿态、落点与承重。</p>`}`;
  }

  function renderAll() {
    renderEditors();
    annotateChanges();
    renderSummary();
    renderBinCards();
    renderBinDetail();
  }

  function capturePrevious() {
    previousPlacement = new Map();
    if (!result) return;
    result.bins.forEach(b => b.placements.forEach(p =>
      previousPlacement.set(p.id, placementSignature(b, p))));
  }

  function replan() {
    readForm();
    capturePrevious();
    result = DP.planLoading(raw);
    renderAll();
  }

  function addContainer() {
    raw.containers.push({
      id: DP.uid("B"), name:`容器 ${raw.containers.length+1}`,
      l:120, w:80, h:100, maxWeight:500, count:1
    });
    renderEditors();
  }

  function addCargo() {
    const index = raw.cargos.length+1;
    raw.cargos.push({
      id: DP.uid("C"), name:`货物 ${index}`,
      l:40, w:30, h:30, weight:20, loadCapacity:0,
      stackable:false, rotatable:true, flippable:false
    });
    renderEditors();
  }

  function addRelation() {
    if (raw.cargos.length < 2) return;
    raw.relations.push({ id:DP.uid("R"), a:raw.cargos[0].id, b:raw.cargos[1].id, type:"incompatible" });
    renderEditors();
  }

  function download(filename, text) {
    const blob = new Blob([text], { type:"application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function exportData() {
    readForm();
    const payload = {
      input: raw,
      solution: result ? {
        success:result.success,
        bins:result.bins.map(b => ({
          binId:b.id, name:b.name,
          placements:b.placements.map(p => ({
            cargoId:p.id, name:p.name, x:p.x, y:p.y, z:p.z,
            l:p.l, w:p.w, h:p.h, orientation:p.orientation
          }))
        })),
        unplaced:result.unplaced.map(c => c.id),
        issues:result.issues
      } : null,
      exportedAt:new Date().toISOString()
    };
    download("loading-plan.json", JSON.stringify(payload, null, 2));
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const incoming = parsed.input || parsed;
        if (!Array.isArray(incoming.cargos) || !Array.isArray(incoming.containers)) {
          throw new Error("JSON 必须包含 cargos 与 containers 数组");
        }
        raw = {
          containers:incoming.containers || [],
          cargos:incoming.cargos || [],
          relations:incoming.relations || [],
          supportRatio:numberOr(incoming.supportRatio, 0.9)
        };
        previousPlacement = new Map();
        renderEditors();
        replan();
      } catch (err) {
        alert(`导入失败：${err.message}`);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function applyRecommendation() {
    if (!recommendation || !recommendation.count) return;
    readForm();
    const byTypeId = new Map((recommendation.additions || [{
      spec:{id:recommendation.containerTypeId}, count:recommendation.count
    }]).map(x => [x.spec.id, x.count]));
    raw.containers = raw.containers.map(b =>
      byTypeId.has(b.id) ? {...b, count:b.count+byTypeId.get(b.id)} : b);
    renderEditors();
    replan();
  }

  document.addEventListener("click", (event) => {
    const btn = event.target.closest("button");
    if (!btn) return;
    if (btn.id === "addContainer") addContainer();
    if (btn.id === "addCargo") addCargo();
    if (btn.id === "addRelation") addRelation();
    if (btn.dataset.deleteContainer) {
      readForm();
      raw.containers = raw.containers.filter(b => b.id !== btn.dataset.deleteContainer);
      renderEditors(); replan();
    }
    if (btn.dataset.deleteCargo) {
      readForm();
      raw.cargos = raw.cargos.filter(c => c.id !== btn.dataset.deleteCargo);
      raw.relations = raw.relations.filter(r => r.a !== btn.dataset.deleteCargo && r.b !== btn.dataset.deleteCargo);
      renderEditors(); replan();
    }
    if (btn.dataset.deleteRelation) {
      readForm();
      raw.relations = raw.relations.filter(r => r.id !== btn.dataset.deleteRelation);
      renderEditors(); replan();
    }
    if (btn.dataset.binId) { selectedBinId = btn.dataset.binId; selectedCargoId = null; renderBinCards(); renderBinDetail(); }
    if (btn.dataset.cargoSelect) { selectedCargoId = btn.dataset.cargoSelect; renderBinDetail(); }
    if (btn.id === "data-close-detail" || btn.dataset.closeDetail !== undefined) { selectedBinId = null; renderBinDetail(); }
    if (btn.id === "applyRecommendation") applyRecommendation();
  });

  document.addEventListener("change", (event) => {
    if (event.target.id === "importFile") {
      const file = event.target.files[0];
      if (file) importData(file);
      event.target.value = "";
      return;
    }
    if (event.target.closest(".data-panel")) replan();
  });

  $("loadSample").addEventListener("click", () => {
    raw = clone(DP.sampleData);
    previousPlacement = new Map();
    renderEditors(); replan();
  });
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("exportBtn").addEventListener("click", exportData);
  $("replanBtn").addEventListener("click", replan);

  renderEditors();
  replan();
})();
