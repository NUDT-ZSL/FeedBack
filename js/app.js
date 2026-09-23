/* UI 层：渲染今日清单、知识点列表与详情，处理全部交互。 */
(function () {
  'use strict';
  var M = window.MemoryModel, P = window.Plan, S = window.Store;
  var $ = function (id) { return document.getElementById(id); };
  var QUALITY_LABELS = ['0 完全忘记', '1 很难回忆', '2 勉强想起', '3 回忆困难', '4 基本顺利', '5 轻松回忆'];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function statusOf(sch) {
    if (sch.neverReviewed) return { cls: 'near', text: '未复习' };
    if (sch.overdueDays > 0.04) return { cls: 'overdue', text: '已逾期 ' + P.fmtDays(sch.overdueDays) };
    if (sch.overdueDays > -0.5) return { cls: 'due', text: '今日到期' };
    return { cls: 'near', text: P.fmtDays(-sch.overdueDays) + ' 后到期' };
  }

  /* ---------- 今日复习视图 ---------- */
  function renderToday() {
    var now = Date.now();
    var plan = P.buildPlan(S.items, S.budget, now);
    var summary = $('planSummary');
    if (!S.items.length) {
      summary.innerHTML = '还没有知识点。请先到「知识点管理」添加要学习的内容。';
    } else if (!plan.list.length) {
      summary.innerHTML = '今天没有到期或临近到期的知识点，好好休息！';
    } else {
      summary.innerHTML = '今日清单：<b>' + plan.list.length + '</b> 个知识点，' +
        '预计用时 <b>' + plan.totalMinutes + '</b> / ' + plan.budget + ' 分钟。' +
        '复习后请点击回忆质量（0~5），系统会立即更新遗忘曲线与排期。';
    }
    var listEl = $('planList');
    listEl.innerHTML = '';
    plan.list.forEach(function (entry) {
      listEl.appendChild(planCard(entry, now));
    });
    var skipped = $('skippedList');
    skipped.innerHTML = '';
    $('skippedHead').hidden = plan.skipped.length === 0;
    plan.skipped.forEach(function (entry) {
      skipped.appendChild(planCard(entry, now, true));
    });
  }

  function planCard(entry, now, compact) {
    var it = entry.item, sch = entry.sch;
    var st = statusOf(sch);
    var card = document.createElement('div');
    card.className = 'card ' + st.cls;
    var pct = sch.neverReviewed ? 0 : Math.round(sch.retention * 100);
    var html = '<div class="card-head"><span class="name">' + esc(it.name) + '</span>' +
      '<span class="badge ' + st.cls + '">' + st.text + '</span>';
    if (sch.state.needsBoost) html += '<span class="badge boost">需要加强</span>';
    html += '<span class="badge">' + (it.minutes || 5) + ' 分钟</span></div>';
    if (!compact) html += '<div class="reason">' + esc(entry.reason || P.reasonFor(sch)) + '</div>';
    html += '<div class="ret-bar" title="当前保持率 ' + pct + '%">' +
      '<div style="width:' + pct + '%"></div></div>';
    if (!compact) {
      html += '<div class="review-row"><span>本次回忆质量：</span>';
      for (var q = 0; q <= 5; q++) {
        html += '<button class="qbtn' + (q <= 2 ? ' q-low' : '') + '" data-q="' + q +
          '" title="' + QUALITY_LABELS[q] + '">' + q + '</button>';
      }
      html += '</div>';
    }
    card.innerHTML = html;
    card.querySelectorAll('.qbtn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        S.addReview(it.id, parseInt(btn.dataset.q, 10));
        renderAll();
      });
    });
    return card;
  }
  /* ---------- 知识点管理视图 ---------- */
  function renderItems() {
    var now = Date.now();
    var listEl = $('itemList');
    listEl.innerHTML = '';
    if (!S.items.length) {
      listEl.innerHTML = '<div class="empty">暂无知识点，请在上方添加。</div>';
      return;
    }
    S.items.forEach(function (it) {
      var sch = P.schedule(it, now);
      var st = statusOf(sch);
      var card = document.createElement('div');
      card.className = 'card ' + st.cls;
      var pct = sch.neverReviewed ? 0 : Math.round(sch.retention * 100);
      var html = '<div class="card-head"><span class="name">' + esc(it.name) + '</span>' +
        '<span class="badge ' + st.cls + '">' + st.text + '</span>';
      if (sch.state.needsBoost) html += '<span class="badge boost">需要加强</span>';
      html += '<span class="badge">稳定度 ' + P.fmtDays(sch.state.stability) + '</span></div>' +
        '<div class="reason">复习 ' + it.reviews.length + ' 次 · 保持率约 ' + pct +
        '% · 间隔 ' + P.fmtDays(sch.intervalDays) + '（点击查看详情 / 调整）</div>' +
        '<div class="ret-bar"><div style="width:' + pct + '%"></div></div>';
      card.innerHTML = html;
      card.style.cursor = 'pointer';
      card.addEventListener('click', function () { openDetail(it.id); });
      listEl.appendChild(card);
    });
  }

  /* ---------- 详情弹窗 ---------- */
  var detailId = null;
  function openDetail(id) {
    detailId = id;
    renderDetail();
    $('detailModal').hidden = false;
  }
  function renderDetail() {
    var it = S.items.filter(function (x) { return x.id === detailId; })[0];
    if (!it) { $('detailModal').hidden = true; return; }
    var now = Date.now();
    var sch = P.schedule(it, now);
    $('detailName').textContent = it.name;
    var st = sch.state;
    $('detailStats').innerHTML =
      '<div>当前保持率<b>' + (sch.neverReviewed ? '—' : Math.round(sch.retention * 100) + '%') + '</b></div>' +
      '<div>记忆稳定度<b>' + P.fmtDays(st.stability) + '</b></div>' +
      '<div>下次到期<b>' + (sch.neverReviewed ? '尽快首学' : fmtTime(sch.dueTs)) + '</b></div>' +
      '<div>遗忘次数<b>' + st.lapses + (st.needsBoost ? '（需加强）' : '') + '</b></div>';
    var ov = $('overrideRange');
    ov.value = Math.min(120, Math.max(0.3, st.stability));
    $('overrideVal').textContent = P.fmtDays(parseFloat(ov.value)) +
      (typeof it.overrideStability === 'number' ? '（手动调整中）' : '（自动推导）');
    var hl = $('historyList');
    var reviews = it.reviews.slice().sort(function (a, b) { return a.ts - b.ts; });
    if (!reviews.length) {
      hl.innerHTML = '<div class="empty">暂无复习记录</div>';
    } else {
      hl.innerHTML = '';
      reviews.forEach(function (rv, idx) {
        var row = document.createElement('div');
        row.className = 'history-row';
        row.innerHTML = '<span>' + fmtTime(rv.ts) + '</span><span>质量 ' + rv.q +
          ' / 5</span><button class="del" title="删除该记录">删除</button>';
        row.querySelector('.del').addEventListener('click', function () {
          if (confirm('删除这条复习记录？排期将按剩余记录重新推导。')) {
            S.deleteReview(detailId, idx);
            renderDetail(); renderToday(); renderItems();
          }
        });
        hl.appendChild(row);
      });
    }
  }
  $('overrideRange').addEventListener('input', function () {
    $('overrideVal').textContent = P.fmtDays(parseFloat(this.value));
  });
  $('applyOverride').addEventListener('click', function () {
    S.setOverride(detailId, parseFloat($('overrideRange').value));
    renderDetail(); renderToday(); renderItems();
  });
  $('clearOverride').addEventListener('click', function () {
    S.clearOverride(detailId);
    renderDetail(); renderToday(); renderItems();
  });
  $('deleteItem').addEventListener('click', function () {
    if (confirm('确定删除该知识点及其全部复习记录？')) {
      S.deleteItem(detailId);
      $('detailModal').hidden = true;
      renderToday(); renderItems();
    }
  });
  $('detailClose').addEventListener('click', function () { $('detailModal').hidden = true; });
  $('detailModal').addEventListener('click', function (e) {
    if (e.target === this) this.hidden = true;
  });
  /* ---------- 顶栏与全局事件 ---------- */
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
      tab.classList.add('active');
      $('view-' + tab.dataset.view).classList.add('active');
    });
  });
  var budgetInput = $('budgetInput');
  budgetInput.value = S.budget;
  budgetInput.addEventListener('change', function () {
    var v = parseInt(budgetInput.value, 10);
    if (isNaN(v) || v < 5) v = 5;
    if (v > 600) v = 600;
    budgetInput.value = v;
    S.setBudget(v);
    renderToday();
  });
  $('addForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('newName').value.trim();
    var mins = parseInt($('newMinutes').value, 10) || M.CFG.defaultMinutes;
    if (!name) return;
    S.addItem(name, mins);
    $('newName').value = '';
    renderItems(); renderToday();
  });
  $('exportBtn').addEventListener('click', function () {
    var blob = new Blob([S.exportJson()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'memory-review-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('importBtn').addEventListener('click', function () { $('importFile').click(); });
  $('importFile').addEventListener('change', function () {
    var f = this.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        S.importJson(reader.result);
        budgetInput.value = S.budget;
        renderAll();
        alert('导入成功');
      } catch (err) { alert('导入失败：' + err.message); }
    };
    reader.readAsText(f);
    this.value = '';
  });

  function renderAll() { renderToday(); renderItems(); }
  renderAll();
})();
