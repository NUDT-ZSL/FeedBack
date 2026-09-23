/* 数据层：localStorage 持久化 + 知识点/复习记录的增删改。
 * 所有状态变化后立即保存，排期由 model 重放推导，保证一致。 */
(function (global) {
  'use strict';
  var KEY = 'memory-review-app-v1';

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && Array.isArray(d.items)) return d;
      }
    } catch (e) { /* 数据损坏时回退到初始状态 */ }
    return { items: [], budget: 30 };
  }

  var db = load();

  function save() { localStorage.setItem(KEY, JSON.stringify(db)); }
  function uid() { return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function find(id) {
    for (var i = 0; i < db.items.length; i++) if (db.items[i].id === id) return db.items[i];
    return null;
  }

  global.Store = {
    get items() { return db.items; },
    get budget() { return db.budget; },
    setBudget: function (m) { db.budget = m; save(); },
    addItem: function (name, minutes) {
      var it = { id: uid(), name: name, minutes: minutes, createdAt: Date.now(), reviews: [] };
      db.items.push(it); save(); return it;
    },
    deleteItem: function (id) {
      db.items = db.items.filter(function (it) { return it.id !== id; }); save();
    },
    addReview: function (id, q, ts) {
      var it = find(id); if (!it) return;
      it.reviews.push({ ts: ts || Date.now(), q: q }); save();
    },
    deleteReview: function (id, index) {
      var it = find(id); if (!it) return;
      it.reviews.sort(function (a, b) { return a.ts - b.ts; });
      it.reviews.splice(index, 1); save();
    },
    setOverride: function (id, stability) {
      var it = find(id); if (!it) return;
      it.overrideStability = stability; save();
    },
    clearOverride: function (id) {
      var it = find(id); if (!it) return;
      delete it.overrideStability; save();
    },
    exportJson: function () { return JSON.stringify(db, null, 2); },
    importJson: function (text) {
      var d = JSON.parse(text);
      if (!d || !Array.isArray(d.items)) throw new Error('数据格式不正确');
      db = d; save();
    }
  };
})(window);
