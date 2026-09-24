/* 界面逻辑：依赖 engine.js 暴露的全局 Engine */
(function () {
  'use strict';
  let state = Engine.sampleState();
  let result = null;
  const logLines = [];

  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function matName(id) {
    const m = state.materials.find(x => x.id === id);
    return m ? m.name : id;
  }
  function prodName(id) {
    const p = state.products.find(x => x.id === id);
    return p ? p.name : id;
  }

  const BADGE = { ok: ['满足', 'b-ok'], shortage: ['缺口', 'b-bad'],
    pending: ['待裁决', 'b-warn'], untrusted: ['不可信', 'b-gray'] };
  function badge(st) {
    const b = BADGE[st] || [st || '?', 'b-gray'];
    return '<span class="badge ' + b[1] + '">' + b[0] + '</span>';
  }

  function log(msg) {
    logLines.unshift(new Date().toLocaleTimeString() + '  ' + msg);
    if (logLines.length > 40) logLines.pop();
  }

  // changed 为 null 表示整体重推；否则只增量重推受影响成品
  function recompute(changed, why) {
    if (!changed) {
      result = Engine.fullAnalysis(state);
      log(why + ' → 整体重推全部成品');
    } else {
      result = Engine.incrementalAnalysis(state, result, changed);
      const names = result.recomputed.map(prodName);
      log(why + ' → 仅重推受影响成品：' + (names.length ? names.join('、') : '无'));
    }
    renderAll();
  }

  function renderMaterials() {
    $('#matBody').innerHTML = state.materials.map(m => {
      const a = result.materials[m.id] || {};
      const supply = a.supply == null ? '—' : a.supply;
      const chain = a.chosen && a.chosen.length > 1
        ? '<div class="chain">替代链: ' + a.chosen.map(matName).join(' → ') + '</div>' : '';
      const issues = (a.issues || []).map(i => '<div class="issue">' + esc(i.detail) + '</div>').join('');
      return '<tr><td><input data-m="' + esc(m.id) + '" data-f="name" value="' + esc(m.name) + '"></td>' +
        '<td><input data-m="' + esc(m.id) + '" data-f="source" value="' + esc(m.source) + '"></td>' +
        '<td><input type="number" min="0" data-m="' + esc(m.id) + '" data-f="arrival" value="' + m.arrival + '"></td>' +
        '<td class="num">' + supply + '</td>' +
        '<td>' + badge(a.status) + chain + issues + '</td>' +
        '<td><button class="del" data-del-mat="' + esc(m.id) + '">删除</button></td></tr>';
    }).join('');
  }

  function renderSubs() {
    const mats = Engine.matMap(state);
    $('#subList').innerHTML = state.subs.map((e, i) =>
      '<li>' + esc(matName(e.from)) + ' → ' + esc(matName(e.to)) +
      (mats.has(e.to) ? '' : ' <span class="badge b-gray">目标不存在</span>') +
      ' <button class="del" data-del-sub="' + i + '">移除</button></li>'
    ).join('') || '<li class="dim">暂无替代关系</li>';
    // 裁决面板：多分支替代链保留各路径依据，由用户选择
    const g = Engine.subEdges(state);
    let html = '';
    for (const entry of g) {
      const from = entry[0], tos = entry[1];
      const valid = tos.filter(t => mats.has(t));
      if (valid.length < 2) continue;
      const cur = state.decisions[from];
      html += '<div class="adj"><b>' + esc(matName(from)) + '</b> 有多条替代路径，请裁决采用哪条：';
      for (const t of valid) {
        const pv = Engine.pathPreview(state, from, t);
        html += '<label class="opt"><input type="radio" name="adj-' + esc(from) + '" data-adj="' + esc(from) +
          '" value="' + esc(t) + '"' + (cur === t ? ' checked' : '') + '> 经 <b>' + esc(matName(t)) + '</b>' +
          ' <span class="dim">路径 ' + pv.nodes.map(matName).join(' → ') + '，合计供给 ' + pv.supply + '</span></label>';
      }
      html += '</div>';
    }
    $('#adjPanel').innerHTML = html || '<div class="dim">当前没有需要裁决的多分支替代链</div>';
  }
  function renderProducts() {
    $('#prodCards').innerHTML = state.products.map(p => {
      const r = result.products[p.id] || {};
      const rows = p.ingredients.map((it, idx) => {
        const ir = (r.ingredients || [])[idx] || {};
        const chain = ir.chain && ir.chain.length > 1
          ? '<div class="chain">' + ir.chain.map(matName).join(' → ') + '</div>' : '';
        const gap = ir.gap > 0 ? '<span class="gap">缺 ' + ir.gap + '</span>' : '';
        const issues = (ir.issues || []).map(i => '<div class="issue">' + esc(i.detail) + '</div>').join('');
        const opts = state.materials.map(m =>
          '<option value="' + esc(m.id) + '"' + (m.id === it.material ? ' selected' : '') + '>' +
          esc(m.name) + '</option>').join('');
        const missing = state.materials.some(m => m.id === it.material) ? '' :
          '<option value="' + esc(it.material) + '" selected>' + esc(it.material) + '(不存在)</option>';
        const rowSt = ir.status !== 'ok' ? ir.status : (ir.gap > 0 ? 'shortage' : 'ok');
        return '<tr><td><select data-p="' + esc(p.id) + '" data-i="' + idx + '" data-f="material">' +
          opts + missing + '</select></td>' +
          '<td><input type="number" min="0" step="any" data-p="' + esc(p.id) + '" data-i="' + idx +
            '" data-f="qty" value="' + it.qty + '"></td>' +
          '<td class="num">' + (ir.demand == null ? '—' : ir.demand) + '</td>' +
          '<td class="num">' + (ir.supply == null ? '—' : ir.supply) + '</td>' +
          '<td>' + badge(rowSt) + ' ' + gap + chain + issues + '</td>' +
          '<td><button class="del" data-del-ing="' + esc(p.id) + ':' + idx + '">删</button></td></tr>';
      }).join('');
      const feas = r.feasibleOutput == null ? '—' : r.feasibleOutput;
      return '<div class="card st-' + r.status + '"><div class="card-h"><b>' + esc(p.name) + '</b> ' +
        badge(r.status) +
        ' <span class="dim">最低产出要求</span> ' +
        '<input type="number" min="0" class="minout" data-p="' + esc(p.id) + '" data-f="minOutput" value="' + p.minOutput + '">' +
        ' <span class="dim">当前可满足产出</span> <b class="feas">' + feas + '</b>' +
        ' <button class="del" data-del-prod="' + esc(p.id) + '">删除成品</button></div>' +
        '<table><thead><tr><th>物料</th><th>单位用量</th><th>需求量</th><th>有效供给</th>' +
        '<th>结论 / 缺口来源</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '<button data-add-ing="' + esc(p.id) + '">+ 添加配料</button></div>';
    }).join('');
  }

  function renderLog() {
    $('#logList').innerHTML = logLines.map(l => '<li>' + esc(l) + '</li>').join('');
  }

  function renderAll() {
    renderMaterials();
    renderSubs();
    renderProducts();
    renderLog();
  }
  // ---- 编辑事件（委托） ----
  document.addEventListener('change', ev => {
    const t = ev.target;
    if (t.dataset.adj) {
      state.decisions[t.dataset.adj] = t.value;
      recompute([t.dataset.adj], '裁决替代路径：' + matName(t.dataset.adj) + ' → ' + matName(t.value));
      return;
    }
    if (t.dataset.m && t.dataset.f) {
      const m = state.materials.find(x => x.id === t.dataset.m);
      if (!m) return;
      if (t.dataset.f === 'arrival') {
        m.arrival = Number(t.value) || 0;
        recompute([m.id], '到货量修正：' + matName(m.id) + ' = ' + m.arrival);
      } else {
        m[t.dataset.f] = t.value;
        renderAll();
      }
      return;
    }
    if (t.dataset.p && t.dataset.f === 'minOutput') {
      const p = state.products.find(x => x.id === t.dataset.p);
      if (!p) return;
      p.minOutput = Number(t.value) || 0;
      recompute(p.ingredients.map(i => i.material), '最低产出调整：' + p.name);
      return;
    }
    if (t.dataset.p && t.dataset.i != null && t.dataset.f) {
      const p = state.products.find(x => x.id === t.dataset.p);
      const it = p && p.ingredients[Number(t.dataset.i)];
      if (!it) return;
      const oldMat = it.material;
      if (t.dataset.f === 'material') it.material = t.value;
      else it.qty = Number(t.value) || 0;
      recompute([oldMat, it.material], '配方调整：' + p.name);
    }
  });

  document.addEventListener('click', ev => {
    const t = ev.target;
    const d = t.dataset;
    if (d.delMat != null) {
      state.materials = state.materials.filter(m => m.id !== d.delMat);
      state.subs = state.subs.filter(e => e.from !== d.delMat && e.to !== d.delMat);
      delete state.decisions[d.delMat];
      recompute(null, '删除物料 ' + d.delMat);
    } else if (d.delSub != null) {
      const e = state.subs.splice(Number(d.delSub), 1)[0];
      if (e && state.decisions[e.from] === e.to) delete state.decisions[e.from];
      recompute(e ? [e.from] : null, '移除替代关系 ' + (e ? matName(e.from) + ' → ' + matName(e.to) : ''));
    } else if (d.delProd != null) {
      state.products = state.products.filter(p => p.id !== d.delProd);
      recompute(null, '删除成品');
    } else if (d.addIng != null) {
      const p = state.products.find(x => x.id === d.addIng);
      if (p && state.materials.length) {
        p.ingredients.push({ material: state.materials[0].id, qty: 1 });
        recompute([state.materials[0].id], '配方新增配料：' + p.name);
      }
    } else if (d.delIng != null) {
      const parts = d.delIng.split(':');
      const p = state.products.find(x => x.id === parts[0]);
      if (p) {
        const it = p.ingredients.splice(Number(parts[1]), 1)[0];
        recompute(it ? [it.material] : null, '配方删除配料：' + p.name);
      }
    }
  });
  // ---- 工具栏与表单 ----
  function bind(id, fn) { $(id).addEventListener('click', fn); }

  bind('#btnAddMat', () => {
    const name = $('#newMatName').value.trim();
    if (!name) return;
    const id = 'M' + Date.now().toString(36).toUpperCase();
    state.materials.push({ id, name, source: $('#newMatSrc').value.trim() || '未填',
      arrival: Number($('#newMatArr').value) || 0 });
    recompute(null, '新增物料 ' + name);
  });

  bind('#btnAddSub', () => {
    const from = $('#subFrom').value, to = $('#subTo').value;
    if (!from || !to || from === to) return;
    state.subs.push({ from, to });
    recompute([from], '新增替代关系 ' + matName(from) + ' → ' + matName(to));
  });

  bind('#btnAddProd', () => {
    const name = $('#newProdName').value.trim();
    if (!name) return;
    const id = 'P' + Date.now().toString(36).toUpperCase();
    state.products.push({ id, name, minOutput: Number($('#newProdMin').value) || 1, ingredients: [] });
    recompute(null, '新增成品 ' + name);
  });

  bind('#btnSample', () => { state = Engine.sampleState(); recompute(null, '载入示例数据'); });

  bind('#btnDemoBad', () => {
    state.subs.push({ from: 'M-ST-B', to: 'M-ST-A' });   // 形成环 钢材A↔钢材B
    state.subs.push({ from: 'M-EM', to: 'M-GHOST' });    // 指向不存在物料
    recompute(null, '注入异常演示（替代环 + 悬空指向）');
  });

  bind('#btnExport', () => {
    $('#jsonBox').hidden = false;
    $('#jsonBox').value = JSON.stringify(state, null, 2);
  });

  bind('#btnImport', () => {
    const box = $('#jsonBox');
    box.hidden = !box.hidden;
    if (box.hidden) return;
    box.value = box.value || JSON.stringify(state, null, 2);
  });

  bind('#btnApplyJson', () => {
    try {
      const s = JSON.parse($('#jsonBox').value);
      if (!Array.isArray(s.materials) || !Array.isArray(s.subs) || !Array.isArray(s.products)) {
        throw new Error('缺少 materials/subs/products 数组');
      }
      s.decisions = s.decisions || {};
      state = s;
      recompute(null, '导入 JSON 数据');
    } catch (e) {
      log('JSON 导入失败：' + e.message);
      renderLog();
    }
  });

  // 动态填充替代关系下拉框（每次渲染后刷新）
  const origRenderAll = renderAll;
  renderAll = function () {
    origRenderAll();
    const opts = state.materials.map(m =>
      '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>').join('');
    $('#subFrom').innerHTML = opts;
    $('#subTo').innerHTML = opts;
  };

  recompute(null, '初始化');
})();
