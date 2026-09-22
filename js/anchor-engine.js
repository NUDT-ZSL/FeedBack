/*
 * anchor-engine.js — 批注锚点重定位核心引擎
 *
 * 思路：把文档表示为“带稳定 ID 的字符序列”。初始文档的每个字符获得唯一 ID，
 * 插入产生新 ID，删除移除 ID。批注锚定区间 [start, end) 对应一组字符 ID。
 * 依次应用全部编辑操作后，根据每组 ID 在最终序列中的存活情况计算状态：
 *   - 全部存活且区间内无外来字符 -> resolved（已解决，未受影响）
 *   - 部分存活（仍有重叠文本）   -> pending（待确认，给出新位置）
 *   - 全部死亡                   -> invalid（失效）
 * 用户在界面对 pending 批注执行“保留”-> resolved；“删除”-> 从文档移除。
 * 该文件同时可在浏览器（window.AnchorEngine）和 Node（module.exports）中使用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AnchorEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATUS = {
    RESOLVED: 'resolved', // 已解决
    PENDING: 'pending',   // 待确认
    INVALID: 'invalid',   // 失效
    DELETED: 'deleted'    // 用户主动删除（不再展示）
  };

  /** 把纯文本变成带稳定 ID 的字符序列 */
  function createDocument(text) {
    var chars = [];
    for (var i = 0; i < text.length; i++) {
      chars.push({ id: 'c' + i, ch: text[i] });
    }
    return { chars: chars, nextId: text.length };
  }

  function assertRange(v, lo, hi, name) {
    if (typeof v !== 'number' || v < lo || v > hi) {
      throw new Error(name + ' 越界: ' + v + ' (允许 ' + lo + '..' + hi + ')');
    }
  }

  /**
   * 在字符序列上应用一条编辑操作（原地修改并返回 doc）。
   * 操作格式（位置均为该操作执行时文档状态下的字符偏移）：
   *   { type: 'insert',  pos, text }
   *   { type: 'delete',  start, end }          // 半开区间 [start, end)
   *   { type: 'replace', start, end, text }    // 等价于 delete + insert
   *   { type: 'move',    start, end, to }      // 剪切 [start,end) 并插入到删除后序列的 to 处
   */
  function applyEdit(doc, edit) {
    var chars = doc.chars;
    if (edit.type === 'insert') {
      assertRange(edit.pos, 0, chars.length, 'insert.pos');
      var added = [];
      for (var i = 0; i < edit.text.length; i++) {
        added.push({ id: 'c' + doc.nextId++, ch: edit.text[i] });
      }
      chars.splice.apply(chars, [edit.pos, 0].concat(added));
    } else if (edit.type === 'delete') {
      assertRange(edit.start, 0, chars.length, 'delete.start');
      assertRange(edit.end, edit.start, chars.length, 'delete.end');
      chars.splice(edit.start, edit.end - edit.start);
    } else if (edit.type === 'replace') {
      applyEdit(doc, { type: 'delete', start: edit.start, end: edit.end });
      applyEdit(doc, { type: 'insert', pos: edit.start, text: edit.text });
    } else if (edit.type === 'move') {
      assertRange(edit.start, 0, chars.length, 'move.start');
      assertRange(edit.end, edit.start, chars.length, 'move.end');
      var seg = chars.splice(edit.start, edit.end - edit.start);
      assertRange(edit.to, 0, chars.length, 'move.to');
      chars.splice.apply(chars, [edit.to, 0].concat(seg));
    } else {
      throw new Error('未知编辑类型: ' + edit.type);
    }
    return doc;
  }

  /** 纯文本方式顺序应用编辑（独立实现，用于交叉验证） */
  function applyEditsToText(text, edits) {
    var s = text;
    for (var i = 0; i < edits.length; i++) {
      var e = edits[i];
      if (e.type === 'insert') {
        s = s.slice(0, e.pos) + e.text + s.slice(e.pos);
      } else if (e.type === 'delete') {
        s = s.slice(0, e.start) + s.slice(e.end);
      } else if (e.type === 'replace') {
        s = s.slice(0, e.start) + e.text + s.slice(e.end);
      } else if (e.type === 'move') {
        var seg2 = s.slice(e.start, e.end);
        var rest = s.slice(0, e.start) + s.slice(e.end);
        s = rest.slice(0, e.to) + seg2 + rest.slice(e.to);
      } else {
        throw new Error('未知编辑类型: ' + e.type);
      }
    }
    return s;
  }

  /**
   * 主入口：根据初始文档、批注和编辑序列，计算每条批注在最新文档中的状态与位置。
   * comments: [{ id, content, start, end }]  // start/end 为初始文档字符偏移，半开区间
   * 返回 { finalText, annotations: [...] }
   */
  function computeAnnotations(initialText, comments, edits) {
    var doc = createDocument(initialText);

    // 每条批注记录其锚定的字符 ID 集合（保持初始区间语义）
    var anchors = comments.map(function (c) {
      assertRange(c.start, 0, initialText.length, 'comment.start');
      assertRange(c.end, c.start, initialText.length, 'comment.end');
      var ids = {};
      for (var i = c.start; i < c.end; i++) ids['c' + i] = true;
      return { comment: c, ids: ids, size: c.end - c.start };
    });

    for (var i = 0; i < edits.length; i++) applyEdit(doc, edits[i]);

    var finalText = doc.chars.map(function (c) { return c.ch; }).join('');

    var annotations = anchors.map(function (a) {
      var first = -1, last = -1, alive = 0;
      for (var i = 0; i < doc.chars.length; i++) {
        if (a.ids[doc.chars[i].id]) {
          if (first === -1) first = i;
          last = i;
          alive++;
        }
      }
      var base = {
        id: a.comment.id,
        content: a.comment.content,
        origStart: a.comment.start,
        origEnd: a.comment.end,
        origText: initialText.slice(a.comment.start, a.comment.end)
      };
      if (alive === 0) {
        base.status = STATUS.INVALID;
        base.start = -1; base.end = -1; base.text = '';
        return base;
      }
      var start = first, end = last + 1;
      // 区间内是否混入非原锚定字符（即锚点内部发生过插入）
      var foreign = 0;
      for (var j = start; j < end; j++) {
        if (!a.ids[doc.chars[j].id]) foreign++;
      }
      var modified = alive < a.size || foreign > 0;
      base.status = modified ? STATUS.PENDING : STATUS.RESOLVED;
      base.start = start;
      base.end = end;
      base.text = finalText.slice(start, end);
      return base;
    });

    return { finalText: finalText, annotations: annotations };
  }

  return {
    STATUS: STATUS,
    createDocument: createDocument,
    applyEdit: applyEdit,
    applyEditsToText: applyEditsToText,
    computeAnnotations: computeAnnotations
  };
});
