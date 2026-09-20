/* 本地持久化：localStorage 不可用时静默降级（仍可完全离线使用） */
(function (global) {
  'use strict';
  var KEY = 'form-cognitive-demo:v1';
  var store = {
    load: function () {
      try {
        var raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    save: function (data) {
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
    },
    clear: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
    }
  };
  global.FormStorage = store;
})(window);
