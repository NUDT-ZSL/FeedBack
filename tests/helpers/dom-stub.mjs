// 最小 DOM 替身：仅实现 TeaController 告警链路用到的
// document.querySelector('[data-param="..."]') 与 element.classList，
// 并记录 classList 调用次数，用于判定闪烁启停与重复触发次数。
export function installDomStub() {
  const previous = globalThis.document;
  const elements = new Map();

  function createElement(paramKey) {
    const classes = new Set();
    const stats = { toggleCount: 0, addCount: 0, removeCount: 0 };
    return {
      paramKey,
      stats,
      classList: {
        toggle(cls) {
          stats.toggleCount++;
          if (classes.has(cls)) classes.delete(cls);
          else classes.add(cls);
        },
        add(cls) {
          stats.addCount++;
          classes.add(cls);
        },
        remove(cls) {
          stats.removeCount++;
          classes.delete(cls);
        },
        contains(cls) {
          return classes.has(cls);
        },
      },
    };
  }

  function ensure(paramKey) {
    if (!elements.has(paramKey)) elements.set(paramKey, createElement(paramKey));
    return elements.get(paramKey);
  }

  globalThis.document = {
    querySelector(selector) {
      const match = /^\[data-param="([^"]+)"\]$/.exec(selector);
      if (!match) return null;
      return ensure(match[1]);
    },
  };

  return {
    element: ensure,
    restore() {
      if (previous === undefined) delete globalThis.document;
      else globalThis.document = previous;
    },
  };
}
