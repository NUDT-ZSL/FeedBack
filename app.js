// ================= 应用状态与动作 =================
const APP = {
  learner: LEARNERS[0].id,
  overrides: {}, // learnerId -> { kp: verdict }
  params: { dailyMinutes: 60, minDwellDays: 1 },
  result: null,
  schedule: null,
};

function ov() {
  return APP.overrides[APP.learner] = APP.overrides[APP.learner] || {};
}

function fullRefresh(reason) {
  APP.result = deriveState(APP.learner, ov());
  APP.schedule = buildSchedule(APP.result, APP.params);
  renderAll();
  if (reason) log(reason);
}

function switchLearner(id) {
  APP.learner = id;
  fullRefresh('已切换到学习者：' + learnerName(id) + '，完成整体重推');
}

function learnerName(id) {
  const l = LEARNERS.find(x => x.id === id);
  return l ? l.name : id;
}

// 裁决矛盾或调整掌握判定：仅增量重推受影响子集，并校验与整体重推一致。
function applyChange(kp, verdict, label) {
  const o = ov();
  if (verdict) o[kp] = verdict; else delete o[kp];
  const prev = APP.result;
  const inc = incrementalRecompute(APP.learner, o, kp, prev);
  APP.result = inc.result;
  const oldSched = APP.schedule;
  APP.schedule = buildSchedule(APP.result, APP.params);
  const moved = diffSchedules(oldSched, APP.schedule);
  renderAll();
  log(label + '：仅增量重推 ' + inc.affected.size + ' 个受影响知识点（' +
      [...inc.affected].join('、') + '），' +
      (inc.consistent ? '与整体重推结果一致 ✓' : '与整体重推不一致 ✗'));
  reportMoved(moved);
}

function applyParams() {
  APP.params = {
    dailyMinutes: Math.max(10, parseInt(document.getElementById('param-daily').value, 10) || 60),
    minDwellDays: Math.max(1, parseInt(document.getElementById('param-dwell').value, 10) || 1),
  };
  const oldSched = APP.schedule;
  APP.schedule = buildSchedule(APP.result, APP.params);
  const moved = diffSchedules(oldSched, APP.schedule);
  renderAll();
  log('节奏参数调整：每日 ' + APP.params.dailyMinutes + ' 分钟，最短停留 ' +
      APP.params.minDwellDays + ' 天，已重新排期');
  reportMoved(moved);
}

function reportMoved(moved) {
  if (!moved.length) { log('排期无变化'); return; }
  const earlier = moved.filter(m => m.delta < 0);
  const later = moved.filter(m => m.delta > 0);
  if (earlier.length)
    log('前移：' + earlier.map(m => nameOf(m.id) + '（提前 ' + (-m.delta) + ' 天）').join('、'));
  if (later.length)
    log('后移：' + later.map(m => nameOf(m.id) + '（推迟 ' + m.delta + ' 天）').join('、'));
}
