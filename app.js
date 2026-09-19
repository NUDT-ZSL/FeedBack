/* 界面逻辑：编辑 -> 重推 -> 画布/冲突/依据 渲染 */
(function () {
  'use strict';

  var SAMPLE = {
    container: { width: 640, padding: 16, gap: 12, lineGap: 12 },
    blocks: [
      { id: 'title', name: '标题', intrinsicW: 200, intrinsicH: 48, flexGrow: 1,
        minW: 120, maxW: 400, minH: 32, maxH: 64, canWrap: false, baselineAlign: false, fixed: null },
      { id: 'text', name: '正文', intrinsicW: 180, intrinsicH: 80, flexGrow: 2,
        minW: 100, maxW: 320, minH: 40, maxH: 160, canWrap: true, baselineAlign: false, fixed: null },
      { id: 'img', name: '图片', intrinsicW: 120, intrinsicH: 90, flexGrow: 0,
        minW: 80, maxW: 160, minH: 60, maxH: 120, canWrap: true, baselineAlign: false, fixed: null },
      { id: 'tag', name: '标签', intrinsicW: 90, intrinsicH: 32, flexGrow: 0,
        minW: 60, maxW: 120, minH: 24, maxH: 40, canWrap: true, baselineAlign: true, fixed: null },
      { id: 'btn', name: '按钮', intrinsicW: 110, intrinsicH: 36, flexGrow: 0,
        minW: 90, maxW: 140, minH: 28, maxH: 44, canWrap: false, baselineAlign: true, fixed: null },
      { id: 'note', name: '脚注', intrinsicW: 140, intrinsicH: 28, flexGrow: 1,
        minW: 100, maxW: 260, minH: 20, maxH: 40, canWrap: true, baselineAlign: true, fixed: null }
    ]
  };

  var state = {
    container: null,
    blocks: [],
    prevResult: null,
    selectedId: null,
    idSeq: 0
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // changed: null=全链重推；{type:'fixed', id}=固定尺寸变更走增量重推
  function relayout(changed) {
    var result, badge = $('modeBadge');
    if (changed && changed.type === 'fixed' && state.prevResult) {
      var inc = LayoutEngine.layoutIncremental(state.prevResult, state.blocks, state.container, changed.id);
      var full = LayoutEngine.layout(state.blocks, state.container);
      var consistent = inc.result.hash === full.hash;
      result = full;
      badge.textContent = inc.mode === 'partial'
        ? '增量重推（自第 ' + (inc.fromLine + 1) + ' 行起）· 与全链' + (consistent ? '一致 ✓' : '不一致 ✗')
        : '全链重推（' + inc.reason + '）';
      badge.className = consistent || inc.mode !== 'partial' ? '' : 'bad';
    } else {
      result = LayoutEngine.layout(state.blocks, state.container);
      badge.textContent = '全链重推 · 哈希 ' + result.hash;
      badge.className = '';
    }
    state.prevResult = result;
    renderCanvas(result);
    renderConflicts(result);
    renderRationale(result);
    $('hashView').textContent = '哈希 ' + result.hash + ' · ' + result.lines.length + ' 行';
  }

  function renderCanvas(result) {
    var cv = $('canvas');
    var c = result.container;
    cv.style.width = c.width + 'px';
    cv.style.height = Math.max(result.contentHeight, 60) + 'px';
    var html = '<div id="padGuide" style="left:' + c.padding + 'px;top:' + c.padding +
      'px;width:' + (c.width - 2 * c.padding) + 'px;height:' +
      Math.max(0, result.contentHeight - 2 * c.padding) + 'px"></div>';
    state.blocks.forEach(function (b) {
      var p = result.blocks[b.id];
      if (!p) return;
      var cls = 'blk';
      if (b.fixed && (b.fixed.w != null || b.fixed.h != null)) cls += ' fixed';
      if (p.squeezed) cls += ' squeezed';
      if (p.overflow) cls += ' overflow';
      if (b.id === state.selectedId) cls += ' sel';
      html += '<div class="' + cls + '" data-id="' + esc(b.id) + '" style="left:' + p.x +
        'px;top:' + p.y + 'px;width:' + p.w + 'px;height:' + p.h + 'px">' +
        esc(b.name || b.id) + '<span class="dim">' + p.w + '×' + p.h + ' @ ' + p.x + ',' + p.y + '</span></div>';
    });
    cv.innerHTML = html;
    cv.querySelectorAll('.blk').forEach(function (el) {
      el.addEventListener('click', function () {
        state.selectedId = el.getAttribute('data-id');
        relayout(null);
        renderEditor();
      });
    });
  }

  var TYPE_NAMES = {
    'no-wrap-overflow': '不可换行溢出',
    'squeezed': '块被挤压',
    'squeeze-overflow': '挤压后仍溢出',
    'fixed-vs-min': '固定值越下限',
    'fixed-vs-max': '固定值越上限'
  };

  function renderConflicts(result) {
    var ul = $('conflictList');
    $('conflictCount').textContent = result.conflicts.length
      ? result.conflicts.length + ' 项' : '';
    if (!result.conflicts.length) {
      ul.innerHTML = '<li class="none">✓ 无冲突，所有约束同时满足</li>';
      return;
    }
    ul.innerHTML = result.conflicts.map(function (cf, i) {
      var axis = cf.axis === 'x' ? '横向' : '纵向';
      var tag = TYPE_NAMES[cf.type] || cf.type;
      return '<li class="' + cf.axis + '" data-i="' + i + '"><span class="tag">[' +
        axis + '·' + esc(tag) + ']</span>参与者：' + esc(cf.parties.join('、')) +
        '<br>' + esc(cf.detail) + '</li>';
    }).join('');
    ul.querySelectorAll('li[data-i]').forEach(function (li) {
      li.addEventListener('click', function () {
        var cf = result.conflicts[Number(li.getAttribute('data-i'))];
        var hit = cf.parties.find(function (p) { return result.blocks[p]; });
        if (hit) { state.selectedId = hit; relayout(null); renderEditor(); }
      });
    });
  }

  function renderRationale(result) {
    var box = $('rationale');
    var id = state.selectedId;
    if (!id || !result.blocks[id]) {
      box.textContent = '点击画布或左侧卡片中的块，查看其位置/尺寸的推导依据。';
      return;
    }
    var p = result.blocks[id];
    var b = state.blocks.find(function (x) { return x.id === id; });
    var flags = '';
    if (b.fixed && (b.fixed.w != null || b.fixed.h != null)) flags += '<span class="flag fx">固定尺寸</span>';
    if (p.squeezed) flags += '<span class="flag sq">被挤压</span>';
    if (p.overflow) flags += '<span class="flag ov">溢出</span>';
    var html = '<div class="geo"><b>' + esc(b.name || id) + '</b>（第 ' + (p.line + 1) + ' 行）' + flags +
      '<br>位置 (' + p.x + ', ' + p.y + ') · 尺寸 ' + p.w + ' × ' + p.h + '</div>';
    html += '<b>推导依据</b><ul>' + (result.reasons[id] || []).map(function (r) {
      return '<li>' + esc(r) + '</li>';
    }).join('') + '</ul>';
    var related = result.conflicts.filter(function (cf) { return cf.parties.indexOf(id) >= 0; });
    if (related.length) {
      html += '<b>涉及冲突</b><ul>' + related.map(function (cf) {
        return '<li>' + esc(TYPE_NAMES[cf.type] || cf.type) + '：' + esc(cf.detail) + '</li>';
      }).join('') + '</ul>';
    }
    box.innerHTML = html;
  }

  var FIELDS = [
    ['intrinsicW', '固有宽'], ['intrinsicH', '固有高'], ['flexGrow', '伸缩权重'],
    ['minW', '最小宽'], ['maxW', '最大宽'], ['minH', '最小高'], ['maxH', '最大高']
  ];

  function renderEditor() {
    var box = $('blockEditor');
    box.innerHTML = state.blocks.map(function (b) {
      var fixed = b.fixed || {};
      var inputs = FIELDS.map(function (f) {
        var v = b[f[0]] == null ? '' : b[f[0]];
        return '<label>' + f[1] + '<input data-id="' + esc(b.id) + '" data-k="' + f[0] +
          '" type="number" step="any" value="' + v + '"></label>';
      }).join('');
      return '<div class="card' + (b.id === state.selectedId ? ' sel' : '') + '" data-card="' + esc(b.id) + '">' +
        '<div class="head"><input name="name" data-id="' + esc(b.id) + '" data-k="name" value="' +
        esc(b.name || '') + '"><button class="del" data-del="' + esc(b.id) + '">删</button></div>' +
        '<div class="grid">' + inputs +
        '<label>固定宽<input data-id="' + esc(b.id) + '" data-k="fixedW" type="number" step="any" value="' +
        (fixed.w == null ? '' : fixed.w) + '" placeholder="空=自动"></label>' +
        '<label>固定高<input data-id="' + esc(b.id) + '" data-k="fixedH" type="number" step="any" value="' +
        (fixed.h == null ? '' : fixed.h) + '" placeholder="空=自动"></label>' +
        '</div>' +
        '<div class="checks"><label><input type="checkbox" data-id="' + esc(b.id) + '" data-k="canWrap"' +
        (b.canWrap !== false ? ' checked' : '') + '> 可换行</label>' +
        '<label><input type="checkbox" data-id="' + esc(b.id) + '" data-k="baselineAlign"' +
        (b.baselineAlign ? ' checked' : '') + '> 基线对齐</label></div></div>';
    }).join('');
    box.querySelectorAll('input').forEach(function (inp) {
      inp.addEventListener('change', onFieldChange);
    });
    box.querySelectorAll('.card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
        state.selectedId = card.getAttribute('data-card');
        relayout(null); renderEditor();
      });
    });
    box.querySelectorAll('[data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-del');
        state.blocks = state.blocks.filter(function (b) { return b.id !== id; });
        if (state.selectedId === id) state.selectedId = null;
        relayout(null); renderEditor();
      });
    });
  }

  function findBlock(id) {
    return state.blocks.find(function (b) { return b.id === id; });
  }

  function onFieldChange(e) {
    var inp = e.target;
    var b = findBlock(inp.getAttribute('data-id'));
    if (!b) return;
    var k = inp.getAttribute('data-k');
    var fixedChanged = false;
    if (k === 'name') { b.name = inp.value; }
    else if (k === 'canWrap' || k === 'baselineAlign') { b[k] = inp.checked; }
    else if (k === 'fixedW' || k === 'fixedH') {
      var v = inp.value === '' ? null : Number(inp.value);
      if (v != null && !Number.isFinite(v)) return;
      b.fixed = b.fixed || { w: null, h: null };
      b.fixed[k === 'fixedW' ? 'w' : 'h'] = v;
      if (b.fixed.w == null && b.fixed.h == null) b.fixed = null;
      fixedChanged = true;
    } else {
      var n = inp.value === '' ? null : Number(inp.value);
      if (n != null && !Number.isFinite(n)) return;
      b[k] = (k === 'maxW' || k === 'maxH') && n == null ? null : (n == null ? 0 : n);
    }
    state.selectedId = b.id;
    relayout(fixedChanged ? { type: 'fixed', id: b.id } : null);
    renderEditor();
  }

  function syncContainerInputs() {
    $('cWidth').value = state.container.width;
    $('cPadding').value = state.container.padding;
    $('cGap').value = state.container.gap;
    $('cLineGap').value = state.container.lineGap;
  }

  function onContainerChange() {
    state.container = {
      width: Number($('cWidth').value) || 0,
      padding: Number($('cPadding').value) || 0,
      gap: Number($('cGap').value) || 0,
      lineGap: Number($('cLineGap').value) || 0
    };
    relayout(null);
  }

  function loadData(data) {
    if (!data || !Array.isArray(data.blocks)) { alert('JSON 格式不正确：需要 blocks 数组'); return; }
    state.container = Object.assign({ width: 640, padding: 16, gap: 12, lineGap: 12 }, data.container);
    state.blocks = data.blocks.map(function (b, i) {
      return Object.assign({
        id: 'b' + i, name: '块' + (i + 1), intrinsicW: 100, intrinsicH: 40, flexGrow: 0,
        minW: 0, maxW: null, minH: 0, maxH: null,
        canWrap: true, baselineAlign: false, fixed: null
      }, b);
    });
    state.selectedId = null;
    state.prevResult = null;
    syncContainerInputs();
    relayout(null);
    renderEditor();
  }

  function init() {
    ['cWidth', 'cPadding', 'cGap', 'cLineGap'].forEach(function (id) {
      $(id).addEventListener('change', onContainerChange);
    });
    $('btnSample').addEventListener('click', function () { loadData(clone(SAMPLE)); });
    $('btnAdd').addEventListener('click', function () {
      var id = 'b' + (++state.idSeq) + '_' + state.blocks.length;
      state.blocks.push({ id: id, name: '新块', intrinsicW: 100, intrinsicH: 40, flexGrow: 0,
        minW: 0, maxW: null, minH: 0, maxH: null, canWrap: true, baselineAlign: false, fixed: null });
      state.selectedId = id;
      relayout(null); renderEditor();
    });
    $('btnLoad').addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try { loadData(JSON.parse(rd.result)); }
        catch (err) { alert('JSON 解析失败：' + err.message); }
      };
      rd.readAsText(f);
      e.target.value = '';
    });
    $('btnExport').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify({ container: state.container, blocks: state.blocks }, null, 2)],
        { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'layout-blocks.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    loadData(clone(SAMPLE));
  }

  init();
})();
