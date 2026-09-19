(function (global) {
  "use strict";

  function deepClone(value) {
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === "object") {
      return Object.keys(value).sort().reduce(function (acc, key) {
        acc[key] = sortKeys(value[key]);
        return acc;
      }, {});
    }
    return value;
  }

  function stableStringify(value) {
    return JSON.stringify(sortKeys(value));
  }

  function stableHash(value) {
    const text = stableStringify(value);
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function shallowEqual(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(function (key) {
      return Object.is(a[key], b[key]);
    });
  }

  function elementsEqual(a, b) {
    if (a === null && b === null) return true;
    if (!a || !b) return false;
    return ["id", "type", "label", "x", "y", "width", "height", "color"]
      .every(function (key) { return Object.is(a[key], b[key]); });
  }

  function makeId(prefix) {
    const random = Math.random().toString(36).slice(2, 8);
    return prefix + "_" + Date.now().toString(36) + random;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  global.WB = global.WB || {};
  global.WB.utils = {
    deepClone,
    stableHash,
    stableStringify,
    shallowEqual,
    elementsEqual,
    makeId,
    clamp
  };
})(typeof window !== "undefined" ? window : globalThis);
