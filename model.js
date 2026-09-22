/* 决策回放 - 数据模型与评分引擎 */
"use strict";

const STORE_KEY = "decisionReplay.v1";
const DAY_MS = 86400000;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function round2(n) { return Math.round(n * 100) / 100; }

const store = {
  data: { decisions: [] },
  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) this.data = JSON.parse(raw);
    } catch (e) { console.warn("读取本地数据失败，已重置", e); }
    if (!this.data.decisions) this.data.decisions = [];
    if (this.data.decisions.length === 0) {
      this.data.decisions.push(seedDecision());
      this.save();
    }
    return this.data;
  },
  save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
  }
};

/* ---- 领域操作 ---- */

function createDecision(title, context) {
  const d = {
    id: uid(), title, context: context || "",
    createdAt: Date.now(),
    options: [], rationales: [], events: [], snapshots: []
  };
  store.data.decisions.push(d);
  return d;
}

function addOption(decision, name) {
  const o = { id: uid(), name, status: "open", createdAt: Date.now(),
              frozenAt: null, frozenScore: null };
  decision.options.push(o);
  return o;
}

function addRationale(decision, optionId, text, direction, weight, halfLifeDays, note) {
  const r = {
    id: uid(), optionId, text,
    direction: Number(direction) >= 0 ? 1 : -1,
    weight: Number(weight),
    halfLifeDays: Math.max(1, Number(halfLifeDays) || 30),
    createdAt: Date.now(),
    status: "active",          // active | invalidated
    invalidatedAt: null, invalidatedBy: null,
    history: []                // 权重变更记录
  };
  decision.rationales.push(r);
  return r;
}

/* 权重随时间指数衰减：eff = weight * 0.5^(ageDays / halfLife) */
function effectiveWeight(r, now) {
  const ageDays = Math.max(0, (now - r.createdAt) / DAY_MS);
  return r.weight * Math.pow(0.5, ageDays / r.halfLifeDays);
}

/* 计算某时刻各选项评估值；已执行/已放弃的选项冻结 */
function computeScores(decision, now) {
  const result = {};
  for (const opt of decision.options) {
    if (opt.status !== "open" && opt.frozenScore !== null) {
      result[opt.id] = { score: opt.frozenScore, frozen: true, contributions: [], dominant: null };
      continue;
    }
    let score = 0;
    const contributions = [];
    for (const r of decision.rationales) {
      if (r.optionId !== opt.id) continue;
      if (r.status === "invalidated") {
        contributions.push({ r, eff: 0, invalidated: true });
        continue;
      }
      const eff = round2(effectiveWeight(r, now) * r.direction);
      score += eff;
      contributions.push({ r, eff, invalidated: false });
    }
    contributions.sort((a, b) => Math.abs(b.eff) - Math.abs(a.eff));
    const dominant = contributions.find(c => !c.invalidated) || null;
    result[opt.id] = { score: round2(score), frozen: false, contributions, dominant };
  }
  return result;
}

/* 重算并保存快照（保留旧结论） */
function recalc(decision, note) {
  const now = Date.now();
  const scores = computeScores(decision, now);
  const snap = { id: uid(), at: now, note: note || "", scores: {} };
  for (const opt of decision.options) {
    const s = scores[opt.id];
    snap.scores[opt.id] = {
      score: s.score,
      frozen: s.frozen,
      dominant: s.dominant ? s.dominant.r.text : (s.frozen ? "（已冻结）" : "—"),
      invalidated: s.contributions.filter(c => c.invalidated).map(c => c.r.text)
    };
  }
  decision.snapshots.push(snap);
  return snap;
}

/* 追加新信息：new=新依据 / boost=强化 / contradict=推翻 */
function applyInfo(decision, info) {
  const ev = { id: uid(), at: Date.now(), text: info.text,
               optionId: info.optionId, mode: info.mode };
  if (info.mode === "new") {
    const r = addRationale(decision, info.optionId, info.text,
                           info.direction, info.weight, info.halfLifeDays || 30);
    ev.rationaleId = r.id;
  } else if (info.mode === "boost") {
    const r = decision.rationales.find(x => x.id === info.targetId);
    if (r) {
      const before = r.weight;
      r.weight = Math.min(10, r.weight + Number(info.delta || 0));
      r.createdAt = Date.now(); // 新证据刷新衰减起点
      r.history.push({ at: Date.now(), from: before, to: r.weight, reason: info.text });
      ev.rationaleId = r.id;
    }
  } else if (info.mode === "contradict") {
    const r = decision.rationales.find(x => x.id === info.targetId);
    if (r) {
      r.status = "invalidated";
      r.invalidatedAt = Date.now();
      r.invalidatedBy = info.text;
      ev.rationaleId = r.id;
    }
  }
  decision.events.push(ev);
  return ev;
}

/* 标记已执行/已放弃：冻结当前评估值 */
function setOptionStatus(decision, optionId, status) {
  const opt = decision.options.find(o => o.id === optionId);
  if (!opt || opt.status !== "open") return;
  const now = Date.now();
  const scores = computeScores(decision, now);
  opt.status = status; // executed | abandoned
  opt.frozenAt = now;
  opt.frozenScore = scores[optionId].score;
  recalc(decision, (status === "executed" ? "选项已执行，评估冻结：" : "选项已放弃，评估冻结：") + opt.name);
}

/* 首次启动的示例数据，便于直接体验 */
function seedDecision() {
  const d = {
    id: uid(), title: "示例：是否跳槽到 B 公司",
    context: "现职稳定但成长有限，B 公司给出 offer，需要在一周内答复。",
    createdAt: Date.now() - 40 * DAY_MS,
    options: [], rationales: [], events: [], snapshots: []
  };
  const o1 = { id: uid(), name: "接受 offer", status: "open", createdAt: d.createdAt, frozenAt: null, frozenScore: null };
  const o2 = { id: uid(), name: "留在现职", status: "open", createdAt: d.createdAt, frozenAt: null, frozenScore: null };
  d.options.push(o1, o2);
  const mk = (optionId, text, dir, w, half, ageDays) => ({
    id: uid(), optionId, text, direction: dir, weight: w, halfLifeDays: half,
    createdAt: Date.now() - ageDays * DAY_MS,
    status: "active", invalidatedAt: null, invalidatedBy: null, history: []
  });
  d.rationales.push(
    mk(o1.id, "薪资提升 35%", 1, 8, 60, 40),
    mk(o1.id, "新团队技术栈更前沿", 1, 6, 45, 40),
    mk(o1.id, "通勤时间翻倍", -1, 4, 90, 40),
    mk(o2.id, "现职人际关系稳定", 1, 5, 60, 40),
    mk(o2.id, "成长空间有限", -1, 6, 30, 40)
  );
  // 历史快照 1：初始判断
  const snap1 = { id: uid(), at: d.createdAt, note: "初始判断快照", scores: {} };
  snap1.scores[o1.id] = { score: 10, frozen: false, dominant: "薪资提升 35%", invalidated: [] };
  snap1.scores[o2.id] = { score: -1, frozen: false, dominant: "成长空间有限", invalidated: [] };
  d.snapshots.push(snap1);
  // 中途事件：旧信息被推翻
  const layoff = d.rationales[1];
  layoff.status = "invalidated";
  layoff.invalidatedAt = Date.now() - 10 * DAY_MS;
  layoff.invalidatedBy = "得知 B 公司该业务线正在收缩";
  d.events.push({ id: uid(), at: layoff.invalidatedAt, text: "得知 B 公司该业务线正在收缩",
                  optionId: o1.id, mode: "contradict", rationaleId: layoff.id });
  d.rationales.push(mk(o1.id, "B 公司业务线收缩，岗位风险上升", -1, 7, 60, 10));
  const snap2 = { id: uid(), at: layoff.invalidatedAt, note: "新信息：B 公司业务线收缩", scores: {} };
  snap2.scores[o1.id] = { score: -2.5, frozen: false, dominant: "B 公司业务线收缩，岗位风险上升",
                          invalidated: ["新团队技术栈更前沿"] };
  snap2.scores[o2.id] = { score: 0.8, frozen: false, dominant: "现职人际关系稳定", invalidated: [] };
  d.snapshots.push(snap2);
  return d;
}
