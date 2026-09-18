/**
 * store.js — 本地持久化层（localStorage），全部数据只存在本机浏览器中。
 * 演示数据以快照形式给出，经内核 loadFromSnapshot 的全套校验后才入库。
 */
(function () {
  'use strict';
  var RC = window.RetentionCore;
  var KEY = 'retention-workbench-v1';

  // 起始时刻仅用于展示“各队列开跑时间不同”；比较一律按相对观察期对齐。
  var SEED_SNAPSHOT = {
    version: 1,
    minCohortsPerStratum: 2,
    cohorts: [
      {
        id: 'organic-0601',
        name: '自然搜索·6/1起跑',
        channel: '自然搜索',
        stratum: '新客',
        size: 1000,
        startAt: '2026-06-01T00:00:00.000Z',
        note: '观察期最长的队列，用于演示“看得久≠留存差”',
        obs: [
          { period: 0, active: 820, source: 'BI日报' },
          { period: 1, active: 700, source: 'BI日报' },
          { period: 2, active: 610, source: 'BI日报' },
          { period: 3, active: 550, source: 'BI日报' },
          { period: 4, active: 520, source: 'BI日报' },
          { period: 5, active: 490, source: 'BI日报' },
          { period: 6, active: 460, source: 'BI日报' },
        ],
        conflicts: [],
      },
      {
        id: 'paid-0615',
        name: '信息流付费·6/15起跑',
        channel: '信息流付费',
        stratum: '新客',
        size: 1200,
        startAt: '2026-06-15T00:00:00.000Z',
        note: '与自然搜索在第2期发生方向反转',
        obs: [
          { period: 0, active: 936, source: 'BI日报' },
          { period: 1, active: 828, source: 'BI日报' },
          { period: 2, active: 756, source: 'BI日报' },
          { period: 3, active: 684, source: 'BI日报' },
          { period: 4, active: 648, source: 'BI日报' },
        ],
        conflicts: [],
      },
      {
        id: 'video-0701',
        name: '短视频·7/1起跑',
        channel: '短视频',
        stratum: '新客',
        size: 800,
        startAt: '2026-07-01T00:00:00.000Z',
        note: '第2期 BI 与渠道回传数值矛盾，待裁决',
        obs: [
          { period: 0, active: 680, source: 'BI日报' },
          { period: 1, active: 560, source: 'BI日报' },
          { period: 2, active: 420, source: 'BI日报' },
          { period: 2, active: 390, source: '渠道回传' },
          { period: 3, active: 360, source: 'BI日报' },
        ],
        conflicts: [],
      },
      {
        id: 'private-0710',
        name: '私域社群·7/10起跑',
        channel: '私域社群',
        stratum: '新客',
        size: 600,
        startAt: '2026-07-10T00:00:00.000Z',
        obs: [
          { period: 0, active: 510, source: '运营周报' },
          { period: 1, active: 450, source: '运营周报' },
          { period: 2, active: 402, source: '运营周报' },
        ],
        conflicts: [],
      },
      {
        id: 'recall-0601',
        name: '老客召回·6/1起跑',
        channel: '召回触达',
        stratum: '老客',
        size: 500,
        startAt: '2026-06-01T00:00:00.000Z',
        note: '老客分层目前只有这一个队列 → 不可比',
        obs: [
          { period: 0, active: 430, source: 'BI日报' },
          { period: 1, active: 360, source: 'BI日报' },
          { period: 2, active: 300, source: 'BI日报' },
          { period: 3, active: 260, source: 'BI日报' },
          { period: 4, active: 225, source: 'BI日报' },
          { period: 5, active: 190, source: 'BI日报' },
        ],
        conflicts: [],
      },
    ],
  };

  var state = null;

  var Store = {
    state: function () {
      return state;
    },

    /** 启动：优先读本地存档；无存档则写入演示数据 */
    init: function () {
      var raw = null;
      try {
        raw = localStorage.getItem(KEY);
      } catch (e) {
        raw = null;
      }
      if (raw) {
        try {
          var loaded = RC.loadFromSnapshot(JSON.parse(raw));
          state = loaded.state;
          return { seeded: false, errors: loaded.errors };
        } catch (e) {
          console.warn('本地存档损坏，回退到演示数据', e);
        }
      }
      var seed = RC.loadFromSnapshot(SEED_SNAPSHOT);
      state = seed.state;
      this.persist();
      return { seeded: true, errors: seed.errors };
    },

    persist: function () {
      try {
        localStorage.setItem(KEY, RC.serialize(state));
      } catch (e) {
        console.warn('写入本地存储失败', e);
      }
    },

    resetSeed: function () {
      var seed = RC.loadFromSnapshot(SEED_SNAPSHOT);
      state = seed.state;
      this.persist();
      return seed.errors;
    },

    exportJson: function () {
      return RC.serialize(state);
    },

    /** 导入快照：全程走内核校验，失败时保留原状态不动 */
    importJson: function (text) {
      var parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        return { ok: false, message: 'JSON 解析失败：' + e.message };
      }
      var loaded = RC.loadFromSnapshot(parsed);
      state = loaded.state;
      this.persist();
      return { ok: true, errors: loaded.errors };
    },
  };

  window.Store = Store;
})();
