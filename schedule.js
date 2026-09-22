// ================= 学习节奏排期 =================
// params: { dailyMinutes, minDwellDays }
// 每个待学知识点的停留天数 = max(最短停留, 预计学时*60/每日分钟数 向上取整)。
function buildSchedule(deriveResult, params) {
  const map = buildIndex();
  const sched = {};
  let day = 0;
  deriveResult.order.forEach(id => {
    const st = deriveResult.state[id];
    if (st.status === 'mastered' || st.status === 'inferred') {
      sched[id] = { start: 0, end: 0, done: true };
      return;
    }
    const days = Math.max(params.minDwellDays, Math.ceil(map[id].hours * 60 / params.dailyMinutes));
    sched[id] = { start: day, end: day + days, done: false };
    day += days;
  });
  return sched;
}

// 对比两次排期：delta<0 表示前移，delta>0 表示后移。
function diffSchedules(oldS, newS) {
  const moved = [];
  if (!oldS) return moved;
  Object.keys(newS).forEach(id => {
    if (!oldS[id] || oldS[id].done || newS[id].done) return;
    const d = newS[id].start - oldS[id].start;
    if (d !== 0) moved.push({ id, delta: d });
  });
  return moved;
}
