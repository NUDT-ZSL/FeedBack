/**
 * FormDeriveEngine
 * 离线表单推导核心：无 DOM / 无外部依赖，可同时在浏览器与 Node 中运行。
 *
 * 表单 schema:
 *   { fields: [
 *       { id, label, required, pattern, dependsOn: [fieldId...],
 *         methods: ['keyboard'|'voice'|'toggle'|'paste'] } ] }
 * 输入事件:
 *   { id, seq, fieldId, source, raw }
 *   - source 取值 keyboard | voice | toggle | paste
 *   - seq 为全局发生顺序（数字小者先发生）
 * 用户裁决:
 *   { [fieldId]: { type:'event', eventId } | { type:'manual', value } }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FormEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SOURCES = ['keyboard', 'voice', 'toggle', 'paste'];
  const SOURCE_LABELS = {
    keyboard: '键盘', voice: '语音', toggle: '开关', paste: '粘贴'
  };

  function asArray(x) { return Array.isArray(x) ? x : []; }
  function uniqPush(set, id) { if (id != null) set.add(String(id)); }

  /** 按输入方式归一化原始内容；保留 raw 用于展示依据 */
  function normalize(raw, source) {
    let v = raw == null ? '' : String(raw);
    v = v.trim();
    if (source === 'toggle') {
      if (/^(on|true|1|yes|开|是)$/i.test(v)) return 'on';
      if (/^(off|false|0|no|关|否)$/i.test(v)) return 'off';
    }
    return v;
  }

  function indexFields(schema) {
    const byId = new Map();
    asArray(schema && schema.fields).forEach(function (f) {
      if (f && f.id != null) byId.set(String(f.id), f);
    });
    return byId;
  }

  /** Tarjan 强连通分量：输出 SCC（Tarjan 顺序为逆拓扑，调用方反转） */
  function tarjan(byId) {
    let next = 0;
    const stack = [], onStack = new Set();
    const index = new Map(), low = new Map();
    const sccs = [];

    function strongConnect(v) {
      index.set(v, next); low.set(v, next); next++;
      stack.push(v); onStack.add(v);
      const f = byId.get(v);
      asArray(f && f.dependsOn).forEach(function (w0) {
        const w = String(w0);
        if (!byId.has(w)) return; // 缺失的依赖边不参与成环分析
        if (!index.has(w)) { strongConnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
        else if (onStack.has(w)) { low.set(v, Math.min(low.get(v), index.get(w))); }
      });
      if (low.get(v) === index.get(v)) {
        const comp = [];
        let w;
        do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
        sccs.push(comp);
      }
    }
    byId.forEach(function (_f, id) { if (!index.has(id)) strongConnect(id); });
    const cycleSet = new Set();
    sccs.forEach(function (comp) {
      if (comp.length > 1) comp.forEach(function (id) { cycleSet.add(id); });
      else {
        const id = comp[0], f = byId.get(id);
        if (asArray(f.dependsOn).map(String).indexOf(id) >= 0) cycleSet.add(id); // 自依赖
      }
    });
    return { sccs: sccs, cycleSet: cycleSet };
  }

  function reverseDeps(byId) {
    const rev = new Map();
    byId.forEach(function (_f, id) { rev.set(id, new Set()); });
    byId.forEach(function (f, id) {
      asArray(f.dependsOn).forEach(function (d0) {
        const d = String(d0);
        if (rev.has(d)) rev.get(d).add(id);
      });
    });
    return rev;
  }

  /** 受影响集合 + 在其内部按依赖给出计算顺序（非受影响依赖从 base 取状态） */
  function affectedOrder(affected, byId) {
    const color = new Map(), order = [];
    function visit(v) {
      const c = color.get(v) || 0;
      if (c === 2) return;
      if (c === 1) return; // 成环时不影响最终结论，成员本就标红
      color.set(v, 1);
      const f = byId.get(v);
      asArray(f && f.dependsOn).forEach(function (d0) {
        const d = String(d0);
        if (byId.has(d) && affected.has(d)) visit(d);
      });
      color.set(v, 2);
      order.push(v);
    }
    Array.from(affected).sort().forEach(visit);
    return order;
  }

  /**
   * 推导单个字段。ctx: { byId, getState(id), cycleSet, resolutions }
   * getState 必须能取到本字段全部依赖的状态（拓扑序保证）。
   */
  function deriveField(field, fieldEvents, ctx) {
    const id = String(field.id);
    const st = {
      id: id,
      label: field.label || id,
      required: !!field.required,
      methods: asArray(field.methods).slice(),
      dependsOn: asArray(field.dependsOn).map(String),
      value: null,
      status: 'empty',
      errors: [],
      candidates: [],
      rejected: [],
      reasons: [],
      resolution: null
    };
    function err(code, message, attribution) {
      st.errors.push({ code: code, message: message, attribution: attribution || {} });
    }

    // 1) 格式要求
    let re = null;
    if (field.pattern != null && field.pattern !== '') {
      try { re = new RegExp('^(?:' + String(field.pattern) + ')$'); }
      catch (e) {
        st.status = 'untrusted';
        st.reasons.push('格式要求无法解析：' + e.message);
        err('SCHEMA_PATTERN', '字段格式要求不是合法正则：' + e.message, { field: id });
        return st;
      }
    }

    // 2) 依赖检查：成环 / 前置缺失 / 前置未确认
    const missingDeps = [], blockedDeps = [];
    asArray(field.dependsOn).forEach(function (d0) {
      const d = String(d0);
      if (!ctx.byId.has(d)) { missingDeps.push(d); return; }
      const ds = ctx.getState(d);
      if (ds && ds.status !== 'confirmable') blockedDeps.push(d);
    });
    if (ctx.cycleSet.has(id)) {
      st.status = 'untrusted';
      st.reasons.push('依赖成环，结论不可信');
      err('DEP_CYCLE', '字段处于依赖环中，无法确定求值顺序', { field: id });
    }
    if (missingDeps.length) {
      st.status = 'untrusted';
      st.reasons.push('前置字段缺失：' + missingDeps.join('、'));
      err('DEP_MISSING', '依赖的前置字段不存在：' + missingDeps.join('、'),
        { field: id, missing: missingDeps.slice() });
    }
    if (st.status === 'untrusted') return st; // 结构性问题：不给结论

    // 3) 沿事件顺序处理输入
    const accepted = []; // {event, value}
    fieldEvents.forEach(function (ev) {
      const src = ev.source;
      if (SOURCES.indexOf(src) < 0) {
        st.rejected.push({ event: ev, reason: '未知输入方式：' + String(src) });
        err('SOURCE_UNKNOWN', '事件来源 ' + String(src) + ' 不是可识别的输入方式',
          { event: ev.id });
        return;
      }
      if (field.methods && field.methods.length && field.methods.indexOf(src) < 0) {
        st.rejected.push({ event: ev, reason: '该字段不接受 ' +
          (SOURCE_LABELS[src] || src) + ' 输入' });
        err('METHOD_UNAVAILABLE', '输入方式 ' + (SOURCE_LABELS[src] || src) +
          ' 不适用于字段「' + st.label + '」，事件被拒绝', { event: ev.id, source: src });
        return;
      }
      accepted.push({ event: ev, value: normalize(ev.raw, src) });
    });

    // 4) 取值分组，识别矛盾
    const groups = new Map(); // value -> events[]
    accepted.forEach(function (a) {
      if (!groups.has(a.value)) groups.set(a.value, []);
      groups.get(a.value).push(a.event);
    });
    groups.forEach(function (events, value) {
      st.candidates.push({
        value: value,
        events: events.map(function (e) {
          return { id: e.id, seq: e.seq, source: e.source,
            sourceLabel: SOURCE_LABELS[e.source] || e.source, raw: e.raw };
        })
      });
    });

    // 5) 用户裁决优先于事件推导
    const res = ctx.resolutions ? ctx.resolutions[id] : null;
    let value = null, decided = false;
    if (res && res.type === 'manual') {
      value = String(res.value == null ? '' : res.value);
      decided = true;
      st.resolution = { type: 'manual', value: value };
    } else if (res && res.type === 'event') {
      const hit = accepted.filter(function (a) { return String(a.event.id) === String(res.eventId); })[0];
      if (hit) {
        value = hit.value; decided = true;
        st.resolution = { type: 'event', eventId: hit.event.id, value: value };
      } else {
        err('RESOLUTION_STALE', '裁决指向的事件不存在或已被拒绝，裁决被忽略',
          { event: res.eventId });
      }
    }
    if (!decided) {
      if (groups.size === 1) { value = Array.from(groups.keys())[0]; decided = true; }
      else if (groups.size > 1) {
        st.status = 'conflict';
        err('CONFLICT', '同一字段收到 ' + groups.size +
          ' 组互相矛盾的输入，需用户裁决后才能给出结论',
          { events: accepted.map(function (a) { return a.event.id; }) });
      }
    }

    // 6) 格式校验（错误归属到具体事件 / 手工录入）
    if (decided && value !== '' && re && !re.test(value)) {
      const attr = {};
      if (st.resolution && st.resolution.type === 'manual') attr.manual = true;
      else {
        attr.events = accepted.filter(function (a) { return a.value === value; })
          .map(function (a) { return a.event.id; });
      }
      err('FORMAT', '值「' + value + '」不满足格式要求 /' + String(field.pattern) + '/', attr);
      st.status = 'blocked';
    }

    // 7) 必填与前置确认
    if (st.status !== 'conflict' && st.status !== 'blocked') {
      const hasValue = decided && value !== '';
      if (!hasValue && field.required) {
        st.status = 'blocked';
        err('REQUIRED', '必填字段「' + st.label + '」尚无有效输入', { field: id });
      } else if (hasValue && blockedDeps.length) {
        st.status = 'blocked';
        err('DEP_UNCONFIRMED', '前置字段未确认：' + blockedDeps.join('、'),
          { field: id, deps: blockedDeps.slice() });
      } else {
        st.status = hasValue ? 'confirmable' : 'empty';
      }
    }
    if (decided) st.value = value;
    return st;
  }

  /** 事件预处理：排序、重复 id 检测、孤儿事件收集 */
  function prepareEvents(events, byId, formErrors) {
    const sorted = asArray(events).slice().sort(function (a, b) {
      return (a.seq || 0) - (b.seq || 0);
    });
    const seen = new Set(), byField = new Map(), orphans = [];
    byId.forEach(function (_f, id) { byField.set(id, []); });
    sorted.forEach(function (ev, i) {
      const e = {
        id: ev.id != null ? String(ev.id) : 'ev' + i,
        seq: ev.seq != null ? ev.seq : i,
        fieldId: ev.fieldId != null ? String(ev.fieldId) : '',
        source: ev.source,
        raw: ev.raw
      };
      if (seen.has(e.id)) {
        formErrors.push({ code: 'EVENT_DUP',
          message: '事件 id「' + e.id + '」重复，后者被忽略', attribution: { event: e.id } });
        return;
      }
      seen.add(e.id);
      if (!byId.has(e.fieldId)) { orphans.push(e); return; }
      byField.get(e.fieldId).push(e);
    });
    if (orphans.length) {
      formErrors.push({ code: 'EVENT_ORPHAN',
        message: orphans.length + ' 条事件指向不存在的字段：' +
          orphans.map(function (e) { return e.id + '->' + e.fieldId; }).join('，'),
        attribution: { events: orphans.map(function (e) { return e.id; }) } });
    }
    return { byField: byField, orphans: orphans, sorted: sorted };
  }

  /** 全量推导：按拓扑序逐字段计算 */
  function deriveForm(schema, events, resolutions) {
    const byId = indexFields(schema);
    const formErrors = [];
    const prep = prepareEvents(events, byId, formErrors);
    const tj = tarjan(byId);
    const states = new Map();
    const ctx = {
      byId: byId,
      cycleSet: tj.cycleSet,
      resolutions: resolutions || {},
      getState: function (id) { return states.get(id) || null; }
    };
    const order = tj.sccs; // Tarjan 输出顺序即“被依赖者在前”的求值顺序
    order.forEach(function (comp) {
      comp.forEach(function (id) {
        states.set(id, deriveField(byId.get(id), prep.byField.get(id) || [], ctx));
      });
    });
    return finalize(states, formErrors, prep.sorted.length, byId);
  }

  /**
   * 增量推导：只重算 changedFieldIds 及其下游，其余字段沿用 base。
   * 结果与全量 deriveForm 完全一致（由测试保证）。
   */
  function deriveFormIncremental(schema, events, resolutions, base, changedFieldIds) {
    if (!base || !base.fields) return deriveForm(schema, events, resolutions);
    const byId = indexFields(schema);
    const formErrors = [];
    const prep = prepareEvents(events, byId, formErrors);
    const tj = tarjan(byId);
    const rev = reverseDeps(byId);
    const affected = new Set();
    asArray(changedFieldIds).forEach(function (c0) {
      const c = String(c0);
      if (!byId.has(c)) return;
      if (affected.has(c)) return;
      affected.add(c);
      (rev.get(c) || new Set()).forEach(function (d) { affected.add(d); });
    });
    // 依赖结构可能变化（调整依赖关系），向下游闭包传播
    let grew = true;
    while (grew) {
      grew = false;
      Array.from(affected).forEach(function (id) {
        (rev.get(id) || new Set()).forEach(function (d) {
          if (!affected.has(d)) { affected.add(d); grew = true; }
        });
      });
    }
    const states = new Map();
    byId.forEach(function (_f, id) {
      if (!affected.has(id) && base.fields[id]) states.set(id, base.fields[id]);
    });
    const ctx = {
      byId: byId,
      cycleSet: tj.cycleSet,
      resolutions: resolutions || {},
      getState: function (id) { return states.get(id) || null; }
    };
    affectedOrder(affected, byId).forEach(function (id) {
      states.set(id, deriveField(byId.get(id), prep.byField.get(id) || [], ctx));
    });
    const result = finalize(states, formErrors, prep.sorted.length, byId);
    result.recomputed = Array.from(affected).sort();
    return result;
  }

  function finalize(states, formErrors, eventCount, byId) {
    const fields = {};
    byId.forEach(function (_f, id) { fields[id] = states.get(id); });
    const counts = { confirmable: 0, blocked: 0, conflict: 0, untrusted: 0, empty: 0 };
    Object.keys(fields).forEach(function (id) { counts[fields[id].status]++; });
    return {
      fields: fields,
      formErrors: formErrors,
      counts: counts,
      eventCount: eventCount,
      canSubmit: counts.blocked === 0 && counts.conflict === 0 &&
        counts.untrusted === 0 && formErrors.length === 0
    };
  }

  return {
    SOURCES: SOURCES,
    SOURCE_LABELS: SOURCE_LABELS,
    normalize: normalize,
    deriveForm: deriveForm,
    deriveFormIncremental: deriveFormIncremental
  };
});
