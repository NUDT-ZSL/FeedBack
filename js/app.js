/* app.js — 界面交互：渲染最新文档、批注高亮、状态管理与用户操作 */
(function () {
  'use strict';
  var E = window.AnchorEngine;
  var STATUS_LABEL = { resolved: '已解决', pending: '待确认', invalid: '已失效' };

  var state = { data: null, applied: 0, decisions: {}, selected: null };

  var $ = function (id) { return document.getElementById(id); };
  var docView = $('docView'), commentList = $('commentList'), statsEl = $('stats');
  var stepRange = $('stepRange'), stepLabel = $('stepLabel');
  var editList = $('editList'), trashInfo = $('trashInfo');

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function init(data) {
    state.data = data;
    state.applied = data.edits.length;
    state.decisions = {};
    state.selected = null;
    stepRange.max = data.edits.length;
    stepRange.value = state.applied;
    render();
  }

  /** 计算当前应展示的批注（应用用户决定后） */
  function currentAnnotations() {
    var d = state.data;
    var r = E.computeAnnotations(d.initialText, d.comments, d.edits.slice(0, state.applied));
    var visible = [], deleted = 0;
    r.annotations.forEach(function (a) {
      var dec = state.decisions[a.id];
      if (dec === 'deleted') { deleted++; return; }
      if (dec === 'resolved' && a.status === E.STATUS.PENDING) a.status = E.STATUS.RESOLVED;
      visible.push(a);
    });
    return { finalText: r.finalText, annotations: visible, deleted: deleted };
  }

  function render() {
    var view = currentAnnotations();
    renderStats(view);
    renderEditList();
    renderDoc(view);
    renderComments(view);
    stepLabel.textContent = state.applied + ' / ' + state.data.edits.length;
    stepRange.value = state.applied;
    trashInfo.textContent = view.deleted > 0 ? '已删除 ' + view.deleted + ' 条批注。' : '';
  }

  function renderStats(view) {
    var counts = { resolved: 0, pending: 0, invalid: 0 };
    view.annotations.forEach(function (a) { counts[a.status]++; });
    statsEl.innerHTML = Object.keys(counts).map(function (k) {
      return '<span><span class="badge ' + k + '">' + STATUS_LABEL[k] + '</span>' +
             counts[k] + ' 条</span>';
    }).join('');
  }

  function renderEditList() {
    editList.innerHTML = state.data.edits.map(function (e, i) {
      var desc = e.type === 'insert' ? '插入@' + e.pos
               : e.type === 'delete' ? '删除[' + e.start + ',' + e.end + ')'
               : e.type === 'replace' ? '替换[' + e.start + ',' + e.end + ')'
               : '移动[' + e.start + ',' + e.end + ')->' + e.to;
      return '<span class="' + (i < state.applied ? 'applied' : '') + '">' +
             (i + 1) + '. ' + desc + '</span>';
    }).join('');
  }

  function renderDoc(view) {
    var marks = view.annotations
      .filter(function (a) { return a.status !== E.STATUS.INVALID && a.start >= 0; })
      .sort(function (a, b) { return a.start - b.start; });
    var html = '', pos = 0;
    marks.forEach(function (a) {
      if (a.start < pos) return; // 防御：跳过重叠区间
      html += esc(view.finalText.slice(pos, a.start));
      html += '<mark class="' + a.status + (a.id === state.selected ? ' selected' : '') +
              '" data-id="' + a.id + '">' + esc(view.finalText.slice(a.start, a.end)) + '</mark>';
      pos = a.end;
    });
    html += esc(view.finalText.slice(pos));
    docView.innerHTML = html;
    Array.prototype.forEach.call(docView.querySelectorAll('mark'), function (m) {
      m.addEventListener('click', function () { select(m.getAttribute('data-id'), true); });
    });
  }

  function renderComments(view) {
    commentList.innerHTML = '';
    view.annotations.forEach(function (a) {
      var card = document.createElement('div');
      card.className = 'comment-card ' + a.status + (a.id === state.selected ? ' selected' : '');
      card.setAttribute('data-id', a.id);

      var html = '<span class="badge ' + a.status + '">' + STATUS_LABEL[a.status] + '</span>';
      html += '<div class="content">' + esc(a.content) + '</div>';
      html += '<div class="anchor-text">原始锚定：' + esc(a.origText) + '</div>';
      if (a.status === E.STATUS.INVALID) {
        html += '<div class="anchor-text">锚定文本已被完全删除，批注失效。</div>';
      } else {
        html += '<div class="anchor-text">当前锚定[' + a.start + ', ' + a.end + ')：' +
                esc(a.text) + '</div>';
      }
      if (a.status === E.STATUS.PENDING) {
        html += '<div class="actions">' +
                '<button class="keep" data-act="keep">保留</button>' +
                '<button class="drop" data-act="drop">删除</button></div>';
      }
      card.innerHTML = html;
      card.addEventListener('click', function (ev) {
        var act = ev.target.getAttribute && ev.target.getAttribute('data-act');
        if (act === 'keep') {
          state.decisions[a.id] = 'resolved';
          render();
        } else if (act === 'drop') {
          state.decisions[a.id] = 'deleted';
          if (state.selected === a.id) state.selected = null;
          render();
        } else {
          select(a.id, false);
        }
      });
      commentList.appendChild(card);
    });
  }

  /** 选中某条批注：高亮对应卡片与文档区间，并按需滚动 */
  function select(id, scrollDoc) {
    state.selected = id;
    Array.prototype.forEach.call(commentList.children, function (c) {
      var on = c.getAttribute('data-id') === id;
      c.classList.toggle('selected', on);
      if (on) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    Array.prototype.forEach.call(docView.querySelectorAll('mark'), function (m) {
      var on = m.getAttribute('data-id') === id;
      m.classList.toggle('selected', on);
      if (on && scrollDoc) m.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  /* ---------- 事件绑定 ---------- */
  stepRange.addEventListener('input', function () {
    state.applied = parseInt(stepRange.value, 10);
    render();
  });
  $('applyAllBtn').addEventListener('click', function () {
    state.applied = state.data.edits.length;
    render();
  });
  $('fileInput').addEventListener('change', function (ev) {
    var f = ev.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data.initialText || !Array.isArray(data.comments) || !Array.isArray(data.edits)) {
          throw new Error('缺少 initialText / comments / edits 字段');
        }
        init(data);
      } catch (err) {
        alert('JSON 格式不正确：' + err.message);
      }
    };
    reader.readAsText(f, 'utf-8');
  });
  document.querySelector('.loadBtn').addEventListener('click', function () {
    $('fileInput').click();
  });

  init(window.SAMPLE_DATA);
})();
