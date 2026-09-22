'use strict';

/** 纯计算核心：日期统一使用 YYYY-MM-DD/UTC，保证推演结果可复现。 */
(function initEngine(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CashflowEngine = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const MS_PER_DAY = 86400000;

  function parseDate(value) {
    if (value instanceof Date) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) throw new Error(`日期必须是 YYYY-MM-DD 格式：${value}`);
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }
  const toISODate = (date) => date.toISOString().slice(0, 10);
  const addDaysISO = (iso, days) => toISODate(new Date(parseDate(iso).getTime() + days * MS_PER_DAY));
  const diffDays = (a, b) => Math.round((parseDate(b) - parseDate(a)) / MS_PER_DAY);
  const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

  function addMonthsClamped(date, months) {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const day = date.getUTCDate();
    const ty = y + Math.floor((m + months) / 12);
    const tm = (m + months) % 12;
    const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    return new Date(Date.UTC(ty, tm, Math.min(day, last)));
  }

  function buildOccurrences(entries, scenario, startISO, endISO) {
    const sc = normalizeScenario(scenario);
    const expandStart = addDaysISO(startISO, -sc.expenseAdvanceDays);
    const expandEnd = addDaysISO(endISO, sc.incomeDelayDays);
    const result = [];

    entries.forEach((rawEntry, index) => {
      const entry = normalizeEntry(rawEntry, index);
      expandEntry(entry, expandStart, expandEnd).forEach((base) => {
        const income = entry.type === 'income';
        let date = base.date;
        let amount = base.amount;
        let deltaDays = 0;
        if (income) {
          date = addDaysISO(base.date, sc.incomeDelayDays);
          deltaDays = sc.incomeDelayDays;
        } else {
          date = addDaysISO(base.date, -sc.expenseAdvanceDays);
          amount = roundMoney(base.amount * (1 + sc.expenseIncreasePct / 100));
          deltaDays = -sc.expenseAdvanceDays;
        }
        result.push({
          key: `${entry.id}__${base.date}`,
          entryId: entry.id,
          name: entry.name,
          type: entry.type,
          recurrence: entry.recurrence,
          baseDate: base.date,
          date,
          baseAmount: roundMoney(base.amount),
          amount,
          amountDelta: roundMoney(amount - base.amount),
          deltaDays,
          inWindow: parseDate(date) >= parseDate(startISO) && parseDate(date) <= parseDate(endISO),
          signedAmount: roundMoney((income ? 1 : -1) * amount)
        });
      });
    });

    return result.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.type !== b.type) return a.type === 'income' ? -1 : 1;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
  }

  function buildDays(events, startISO, endISO, startingBalance, safetyLine) {
    const totalDays = diffDays(startISO, endISO) + 1;
    if (totalDays <= 0 || totalDays > 3660) throw new Error('推演区间需要在 1 至 3660 天之间');
    const byDate = new Map();
    events.forEach((event) => {
      if (!event.inWindow) return;
      if (!byDate.has(event.date)) byDate.set(event.date, []);
      byDate.get(event.date).push(event);
    });

    let balance = roundMoney(startingBalance);
    let cumulativeGap = 0;
    const days = [];
    for (let offset = 0; offset < totalDays; offset += 1) {
      const date = addDaysISO(startISO, offset);
      const todays = byDate.get(date) || [];
      todays.forEach((event) => { balance = roundMoney(balance + event.signedAmount); });
      const dailyGap = balance < safetyLine ? roundMoney(safetyLine - balance) : 0;
      cumulativeGap = roundMoney(Math.max(cumulativeGap, dailyGap));
      days.push({
        date,
        income: roundMoney(todays.filter((x) => x.type === 'income').reduce((s, x) => s + x.amount, 0)),
        expense: roundMoney(todays.filter((x) => x.type === 'expense').reduce((s, x) => s + x.amount, 0)),
        netChange: roundMoney(todays.reduce((s, x) => s + x.signedAmount, 0)),
        balance,
        dailyGap,
        cumulativeGap,
        eventCount: todays.length
      });
    }
    return days;
  }
  function normalizeEntry(entry, index = 0) {
    if (!entry || typeof entry !== 'object') throw new Error(`第 ${index + 1} 笔收支格式不正确`);
    const type = entry.type === 'income' ? 'income' : 'expense';
    const recurrence = ['monthly', 'quarterly', 'once'].includes(entry.recurrence) ? entry.recurrence : null;
    if (!recurrence) throw new Error('重复规律必须是 monthly、quarterly 或 once');
    const amount = Number(entry.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('收支金额必须大于 0');
    const startDate = toISODate(parseDate(entry.startDate || entry.date));
    let endDate = entry.endDate ? toISODate(parseDate(entry.endDate)) : '';
    if (recurrence === 'once') endDate = startDate;
    if (endDate && parseDate(endDate) < parseDate(startDate)) throw new Error('结束日期不能早于开始日期');
    return { id: String(entry.id || `entry-${index + 1}`), name: String(entry.name || (type === 'income' ? '未命名收入' : '未命名支出')).trim(), type, amount: roundMoney(amount), startDate, recurrence, endDate };
  }

  function normalizeScenario(input = {}) {
    const intValue = (value, fallback = 0) => {
      const n = Math.trunc(Number(value ?? fallback));
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    const pct = Number(input.expenseIncreasePct ?? 0);
    return {
      incomeDelayDays: intValue(input.incomeDelayDays),
      expenseAdvanceDays: intValue(input.expenseAdvanceDays),
      expenseIncreasePct: Number.isFinite(pct) && pct >= 0 ? roundMoney(pct) : 0
    };
  }

  function expandEntry(entry, rangeStartISO, rangeEndISO) {
    const rangeStart = parseDate(rangeStartISO);
    const rangeEnd = parseDate(rangeEndISO);
    const start = parseDate(entry.startDate);
    const end = entry.endDate ? parseDate(entry.endDate) : rangeEnd;
    const result = [];
    if (entry.recurrence === 'once') {
      if (start >= rangeStart && start <= rangeEnd) result.push({ date: toISODate(start), amount: entry.amount });
      return result;
    }
    const step = entry.recurrence === 'quarterly' ? 3 : 1;
    for (let i = 0; i < 10000; i += 1) {
      const current = addMonthsClamped(start, i * step);
      if (current > end || current > rangeEnd) break;
      if (current >= rangeStart) result.push({ date: toISODate(current), amount: entry.amount });
    }
    return result;
  }

  function moneyLabel(value) {
    const abs = Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${value < 0 ? '-' : ''}¥${abs}`;
  }

  function decorateEvent(event, breachDate) {
    const baselineContribution = event.baseDate <= breachDate ? (event.type === 'income' ? event.baseAmount : -event.baseAmount) : 0;
    const scenarioContribution = event.date <= breachDate ? event.signedAmount : 0;
    const delta = roundMoney(scenarioContribution - baselineContribution);
    const tags = [];
    if (event.type === 'expense') {
      if (event.deltaDays < 0) tags.push({ code: 'expense_advanced', label: `提前 ${Math.abs(event.deltaDays)} 天` });
      if (event.amountDelta > 0) tags.push({ code: 'amount_increased', label: `上浮 ${moneyLabel(event.amountDelta)}` });
      if (!tags.length) tags.push({ code: 'expense_due', label: '按计划扣款' });
    }
    if (event.type === 'income' && event.baseDate <= breachDate && event.date > breachDate) {
      tags.push({ code: 'income_delayed', label: `延迟 ${event.deltaDays} 天，跌破日尚未到账` });
    }
    return { ...event, baselineContribution: roundMoney(baselineContribution), scenarioContribution: roundMoney(scenarioContribution), delta, adverseImpact: roundMoney(Math.abs(Math.min(0, delta))), tags };
  }

  function findAttribution(events, breachDay, safetyLine) {
    const d = breachDay.date;
    const map = new Map();
    const add = (event) => map.set(event.key, decorateEvent(event, d));
    events.filter((e) => e.inWindow && e.date === d && e.type === 'expense').forEach(add);
    events.filter((e) => e.type === 'income' && e.baseDate <= d && e.date > d).forEach(add);
    events.filter((e) => e.type === 'expense' && e.date <= d && (e.deltaDays < 0 || e.amountDelta > 0)).forEach(add);
    const relevant = Array.from(map.values()).sort((a, b) => b.adverseImpact - a.adverseImpact || (a.date < b.date ? -1 : 1) || (a.name < b.name ? -1 : 1));

    const dayExpenses = relevant.filter((e) => e.date === d && e.type === 'expense');
    const delayedIncomes = relevant.filter((e) => e.type === 'income');
    const advanced = relevant.filter((e) => e.type === 'expense' && e.deltaDays < 0);
    const increased = relevant.filter((e) => e.type === 'expense' && e.amountDelta > 0);
    const factor = (code, label, items) => ({ code, label, total: roundMoney(items.reduce((s, e) => s + e.adverseImpact, 0)), eventKeys: items.map((e) => e.key) });
    const factors = [];
    if (dayExpenses.length) factors.push({ code: 'same_day_expense', label: `${dayExpenses.length} 笔支出在当日扣款`, total: roundMoney(dayExpenses.reduce((s, e) => s + e.amount, 0)), eventKeys: dayExpenses.map((e) => e.key) });
    if (delayedIncomes.length) factors.push(factor('income_delayed', `${delayedIncomes.length} 笔收入跌破日尚未到账`, delayedIncomes));
    if (advanced.length) factors.push(factor('expense_advanced', `${advanced.length} 笔支出提前支付`, advanced));
    if (increased.length) factors.push(factor('amount_increased', `${increased.length} 笔支出金额上浮`, increased));

    const names = (items) => items.slice(0, 3).map((e) => `${e.name} ${moneyLabel(e.amount)}`).join('、');
    let summary;
    if (!dayExpenses.length) {
      summary = `期初可用资金已低于安全线 ${moneyLabel(safetyLine - breachDay.balance)}，当日没有足以补足缺口的现金流入。`;
    } else {
      const parts = [`当日扣款 ${names(dayExpenses)}，合计 ${moneyLabel(dayExpenses.reduce((s, e) => s + e.amount, 0))}`];
      if (delayedIncomes.length) parts.push(`${names(delayedIncomes)} 等收入尚未到账`);
      if (advanced.length) parts.push(`${advanced.length} 笔支出已提前流出`);
      if (increased.length) parts.push(`${increased.length} 笔支出高于基准金额`);
      summary = `${parts.join('；')}，使余额首次降至安全线以下。`;
    }
    return { date: d, balance: breachDay.balance, safetyLine, gap: roundMoney(safetyLine - breachDay.balance), summary, factors, events: relevant };
  }

  function runSimulation(input) {
    const entries = (input.entries || []).map((entry, index) => normalizeEntry(entry, index));
    if (!entries.length) throw new Error('请至少维护一笔收入或支出');
    const openingBalance = Number(input.openingBalance ?? 0);
    const safetyLine = Number(input.safetyLine ?? 0);
    if (!Number.isFinite(openingBalance)) throw new Error('期初余额必须是数字');
    if (!Number.isFinite(safetyLine)) throw new Error('安全线必须是数字');
    const startDate = toISODate(parseDate(input.startDate));
    const endDate = toISODate(parseDate(input.endDate));
    if (parseDate(endDate) < parseDate(startDate)) throw new Error('结束日期不能早于开始日期');
    const scenario = normalizeScenario(input.scenario);

    const baselineEvents = buildOccurrences(entries, {}, startDate, endDate);
    const scenarioEvents = buildOccurrences(entries, scenario, startDate, endDate);
    const preStartImpact = roundMoney(scenarioEvents.filter((e) => !e.inWindow && parseDate(e.date) < parseDate(startDate)).reduce((s, e) => s + e.signedAmount, 0));
    const scenarioStartBalance = roundMoney(openingBalance + preStartImpact);

    const baselineDays = buildDays(baselineEvents, startDate, endDate, openingBalance, safetyLine);
    const days = buildDays(scenarioEvents, startDate, endDate, scenarioStartBalance, safetyLine);
    const breachDay = days.find((day) => day.balance < safetyLine) || null;
    const firstBreach = breachDay ? findAttribution(scenarioEvents, breachDay, safetyLine) : null;
    const finalDay = days[days.length - 1];

    return {
      entries,
      scenario,
      dateRange: { startDate, endDate },
      openingBalance: roundMoney(openingBalance),
      scenarioStartBalance,
      safetyLine: roundMoney(safetyLine),
      baseline: { events: baselineEvents, days: baselineDays },
      scenario: { events: scenarioEvents, days },
      firstBreach,
      finalBalance: finalDay.balance,
      maxCumulativeGap: finalDay.cumulativeGap,
      breached: Boolean(firstBreach)
    };
  }

  return {
    parseDate,
    toISODate,
    addDaysISO,
    diffDays,
    normalizeEntry,
    normalizeScenario,
    expandEntry,
    buildOccurrences,
    buildDays,
    runSimulation,
    findAttribution
  };
});
