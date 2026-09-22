// ================= 渲染：矛盾裁决 / 路径排期 / 日志 / 节点菜单 =================
function log(msg) {
  const ul = document.getElementById('log');
  const li = document.createElement('li');
  li.textContent = msg;
  ul.insertBefore(li, ul.firstChild);
  while (ul.children.length > 30) ul.removeChild(ul.lastChild);
}

function openNodeMenu(kp, ev) {
  const menu = document.getElementById('node-menu');
  const st = APP.result.state[kp];
  menu.innerHTML = '';
  const title = document.createElement('div');
  title.textContent = kp + ' ' + nameOf(kp) +
    (st.source ? '（来源：' + st.source + '）' : '');
  menu.appendChild(title);
  function btn(text, fn) {
    const b = document.createElement('button');
    b.textContent = text;
    b.onclick = () => { menu.classList.add('hidden'); fn(); };
    menu.appendChild(b);
  }
  btn('标记为已掌握', () => applyChange(kp, 'mastered', kp + ' 被调整为「已掌握」'));
  btn('标记为未掌握', () => applyChange(kp, 'failed', kp + ' 被调整为「未掌握」'));
  if (ov()[kp]) btn('清除此项调整', () => applyChange(kp, null, kp + ' 的调整已清除'));
  const close = document.createElement('button');
  close.textContent = '关闭';
  close.className = 'ghost';
  close.onclick = () => menu.classList.add('hidden');
  menu.appendChild(close);
  const wrap = document.getElementById('center');
  menu.style.left = (ev.clientX - wrap.getBoundingClientRect().left + 10) + 'px';
  menu.style.top = (ev.clientY - wrap.getBoundingClientRect().top + 10) + 'px';
  menu.classList.remove('hidden');
  ev.stopPropagation();
}

function renderConflicts() {
  const box = document.getElementById('conflicts');
  box.innerHTML = '';
  const conflicts = APP.result.conflicts;
  const keys = Object.keys(conflicts);
  if (!keys.length) {
    box.textContent = '当前学习者没有待裁决的矛盾记录。';
    return;
  }
  keys.forEach(kp => {
    const item = document.createElement('div');
    item.className = 'conflict-item';
    const head = document.createElement('div');
    head.textContent = kp + ' ' + nameOf(kp) + ' 存在互相矛盾的掌握判定：';
    item.appendChild(head);
    conflicts[kp].records.forEach(r => {
      const rec = document.createElement('div');
      rec.className = 'rec';
      rec.textContent = '· ' + r.ts.replace('T', ' ') + '  ' + r.source +
        ' → ' + (r.verdict === 'mastered' ? '掌握' : '未掌握');
      item.appendChild(rec);
    });
    const acts = document.createElement('div');
    acts.className = 'actions';
    if (ov()[kp]) {
      const note = document.createElement('span');
      note.className = 'ok-note';
      note.textContent = '已裁决为「' + (ov()[kp] === 'mastered' ? '掌握' : '未掌握') + '」';
      acts.appendChild(note);
    } else {
      [['mastered', '采纳「掌握」'], ['failed', '采纳「未掌握」']].forEach(pair => {
        const b = document.createElement('button');
        b.textContent = pair[1];
        b.onclick = () => applyChange(kp, pair[0],
          kp + ' 的矛盾已裁决为「' + (pair[0] === 'mastered' ? '掌握' : '未掌握') + '」');
        acts.appendChild(b);
      });
    }
    item.appendChild(acts);
    box.appendChild(item);
  });
}

function renderPath() {
  const ol = document.getElementById('path');
  ol.innerHTML = '';
  APP.result.order.forEach(id => {
    const st = APP.result.state[id];
    const ds = displayStatus(id);
    const meta = STATUS_META[ds];
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = id + ' ' + nameOf(id);
    li.appendChild(name);
    const tag = document.createElement('span');
    tag.className = 'tag ' + ds;
    tag.textContent = meta.label;
    li.appendChild(tag);
    const sch = APP.schedule[id];
    if (sch && !sch.done) {
      const days = document.createElement('span');
      days.className = 'days';
      days.textContent = '第 ' + (sch.start + 1) + '–' + sch.end + ' 天';
      li.appendChild(days);
    }
    if (ds === 'locked' && st.missingPrereqs.length) {
      const why = document.createElement('span');
      why.className = 'locked-why';
      why.textContent = '未解锁：需先掌握 ' + st.missingPrereqs.join('、');
      li.appendChild(why);
    }
    if (ds === 'untrusted') {
      const why = document.createElement('span');
      why.className = 'locked-why';
      why.textContent = '受依赖环/缺失依赖影响，结论不可信';
      li.appendChild(why);
    }
    ol.appendChild(li);
  });
  const untrusted = KNOWLEDGE.filter(k => APP.result.state[k.id].untrusted);
  untrusted.forEach(k => {
    const li = document.createElement('li');
    li.textContent = k.id + ' ' + k.name;
    const tag = document.createElement('span');
    tag.className = 'tag untrusted';
    tag.textContent = '不可信';
    li.appendChild(tag);
    const why = document.createElement('span');
    why.className = 'locked-why';
    why.textContent = '受依赖环/缺失依赖影响，不纳入学习路径';
    li.appendChild(why);
    ol.appendChild(li);
  });
}

// ================= 启动 =================
document.getElementById('apply-params').onclick = applyParams;
document.addEventListener('click', ev => {
  const menu = document.getElementById('node-menu');
  if (!menu.contains(ev.target)) menu.classList.add('hidden');
});
fullRefresh('初始推演完成：图谱校验、矛盾识别、路径推导与排期已就绪');
