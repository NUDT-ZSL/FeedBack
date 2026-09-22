'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/engine');

test('按月和按季计划展开到具体日期，一次性计划只出现一次', () => {
  const monthly = engine.expandEntry({ id: 'salary', type: 'income', amount: 100, startDate: '2026-01-31', recurrence: 'monthly' }, '2026-01-01', '2026-04-30');
  assert.deepEqual(monthly.map((x) => x.date), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);

  const quarterly = engine.expandEntry({ id: 'tax', type: 'expense', amount: 50, startDate: '2026-01-15', recurrence: 'quarterly' }, '2026-01-01', '2026-12-31');
  assert.deepEqual(quarterly.map((x) => x.date), ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']);

  const once = engine.expandEntry({ id: 'gift', type: 'income', amount: 50, startDate: '2026-02-10', recurrence: 'once' }, '2026-01-01', '2026-03-01');
  assert.deepEqual(once.map((x) => x.date), ['2026-02-10']);
});

test('三类情景同时叠加，并定位首次跌破日期、余额和共同原因', () => {
  const result = engine.runSimulation({
    openingBalance: 100,
    safetyLine: 50,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    entries: [
      { id: 'salary', name: '工资', type: 'income', amount: 80, startDate: '2026-01-05', recurrence: 'once' },
      { id: 'rent', name: '房租', type: 'expense', amount: 100, startDate: '2026-01-10', recurrence: 'once' },
      { id: 'stuff', name: '采购', type: 'expense', amount: 20, startDate: '2026-01-08', recurrence: 'once' }
    ],
    scenario: { incomeDelayDays: 10, expenseAdvanceDays: 3, expenseIncreasePct: 10 }
  });

  // 1/5 采购提前至 1/5 且上浮至 22；工资推迟到 1/15；1/10 时余额为 78，未跌破。
  assert.equal(result.scenario.days.find((d) => d.date === '2026-01-05').balance, 78);
  // 1/7 房租提前至 1/7 且上浮至 110，余额 -32。
  assert.equal(result.firstBreach.date, '2026-01-07');
  assert.equal(result.firstBreach.balance, -32);
  assert.equal(result.firstBreach.gap, 82);
  assert.ok(result.firstBreach.summary.includes('房租'));
  const codes = result.firstBreach.factors.map((x) => x.code);
  assert.ok(codes.includes('same_day_expense'));
  assert.ok(codes.includes('income_delayed'));
  assert.ok(codes.includes('expense_advanced'));
  assert.ok(codes.includes('amount_increased'));
});

test('不会影响首次跌破的无关参数保持缺口时点稳定', () => {
  const input = {
    openingBalance: 100,
    safetyLine: 20,
    startDate: '2026-01-01',
    endDate: '2026-02-28',
    entries: [
      { id: 'salary', name: '工资', type: 'income', amount: 100, startDate: '2026-01-20', recurrence: 'once' },
      { id: 'rent', name: '房租', type: 'expense', amount: 150, startDate: '2026-01-10', recurrence: 'once' }
    ],
    scenario: { incomeDelayDays: 30, expenseAdvanceDays: 0, expenseIncreasePct: 0 }
  };
  const first = engine.runSimulation(input);
  const second = engine.runSimulation({ ...input, scenario: { ...input.scenario, expenseAdvanceDays: 0, expenseIncreasePct: 0 } });
  assert.equal(first.firstBreach.date, '2026-01-10');
  assert.equal(second.firstBreach.date, first.firstBreach.date);
  assert.equal(second.firstBreach.balance, first.firstBreach.balance);
});
