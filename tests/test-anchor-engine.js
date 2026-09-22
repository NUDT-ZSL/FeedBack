/*
 * test-anchor-engine.js — 引擎单元测试 + 随机化一致性测试
 * 运行: node tests/test-anchor-engine.js
 */
'use strict';
const assert = require('assert');
const E = require('../js/anchor-engine.js');
const SAMPLE = require('../data/sample.js');

let passed = 0;
function ok(name, fn) { fn(); passed++; console.log('  PASS ' + name); }

/* ---------- 独立实现：逐偏移映射（用于交叉验证） ---------- */
// 把单个字符偏移映射通过一条编辑；返回新偏移，字符被删除则返回 -1
function mapOffset(pos, e) {
  if (e.type === 'insert') {
    return pos < e.pos ? pos : pos + e.text.length;
  }
  if (e.type === 'delete') {
    if (pos < e.start) return pos;
    if (pos >= e.end) return pos - (e.end - e.start);
    return -1;
  }
  if (e.type === 'replace') {
    if (pos < e.start) return pos;
    if (pos >= e.end) return pos - (e.end - e.start) + e.text.length;
    return -1;
  }
  if (e.type === 'move') {
    var len = e.end - e.start;
    if (pos >= e.start && pos < e.end) return e.to + (pos - e.start);
    var r = pos < e.start ? pos : pos - len; // 在剩余序列中的位置
    return r < e.to ? r : r + len;
  }
  throw new Error('未知编辑类型: ' + e.type);
}

// 独立计算某批注在编辑序列后的期望结果
function expectedAnnotation(initialText, c, edits) {
  var survivors = [];
  for (var i = c.start; i < c.end; i++) {
    var p = i;
    for (var j = 0; j < edits.length && p !== -1; j++) p = mapOffset(p, edits[j]);
    if (p !== -1) survivors.push(p);
  }
  if (survivors.length === 0) return { status: 'invalid' };
  var start = Math.min.apply(null, survivors);
  var end = Math.max.apply(null, survivors) + 1;
  var inSet = {};
  survivors.forEach(function (p) { inSet[p] = true; });
  var modified = survivors.length < c.end - c.start;
  for (var k = start; k < end; k++) if (!inSet[k]) modified = true;
  return { status: modified ? 'pending' : 'resolved', start: start, end: end };
}

/* ---------- 单元测试 ---------- */
console.log('单元测试:');

ok('未受影响批注 -> resolved，位置随前面插入平移', function () {
  var r = E.computeAnnotations('abcdef', [{ id: 'x', content: '', start: 2, end: 4 }],
    [{ type: 'insert', pos: 0, text: 'ZZ' }]);
  assert.strictEqual(r.finalText, 'ZZabcdef');
  assert.deepStrictEqual([r.annotations[0].status, r.annotations[0].start, r.annotations[0].end],
    ['resolved', 4, 6]);
});

ok('锚点部分删除 -> pending，区间收缩到存活文本', function () {
  var r = E.computeAnnotations('abcdef', [{ id: 'x', content: '', start: 1, end: 5 }],
    [{ type: 'delete', start: 3, end: 5 }]);
  assert.strictEqual(r.finalText, 'abcf');
  var a = r.annotations[0];
  assert.strictEqual(a.status, 'pending');
  assert.strictEqual(a.text, 'bc');
});

ok('锚点整体删除 -> invalid', function () {
  var r = E.computeAnnotations('abcdef', [{ id: 'x', content: '', start: 1, end: 4 }],
    [{ type: 'delete', start: 0, end: 6 }]);
  assert.strictEqual(r.annotations[0].status, 'invalid');
});

ok('锚点内部插入 -> pending，区间包含新文本', function () {
  var r = E.computeAnnotations('abcdef', [{ id: 'x', content: '', start: 1, end: 4 }],
    [{ type: 'insert', pos: 2, text: 'QQ' }]);
  var a = r.annotations[0];
  assert.strictEqual(a.status, 'pending');
  assert.strictEqual(a.text, 'bQQcd');
});

ok('move 操作后批注跟随到新位置且保持 resolved', function () {
  var r = E.computeAnnotations('ABCdefghi', [{ id: 'x', content: '', start: 0, end: 3 }],
    [{ type: 'move', start: 0, end: 3, to: 6 }]);
  assert.strictEqual(r.finalText, 'defghiABC');
  var a = r.annotations[0];
  assert.strictEqual(a.status, 'resolved');
  assert.strictEqual(a.text, 'ABC');
  assert.strictEqual(a.start, 6);
});

ok('replace 等价于 delete+insert', function () {
  var r = E.computeAnnotations('hello world', [{ id: 'x', content: '', start: 0, end: 5 }],
    [{ type: 'replace', start: 6, end: 11, text: 'there' }]);
  assert.strictEqual(r.finalText, 'hello there');
  assert.strictEqual(r.annotations[0].status, 'resolved');
});

ok('多次编辑叠加：最终文本与直接顺序应用一致', function () {
  var edits = [
    { type: 'insert', pos: 5, text: ' beautiful' },
    { type: 'delete', start: 0, end: 2 },
    { type: 'replace', start: 3, end: 12, text: 'cruel' },
    { type: 'move', start: 0, end: 3, to: 8 }
  ];
  var r = E.computeAnnotations('hello brave new world', [], edits);
  assert.strictEqual(r.finalText, E.applyEditsToText('hello brave new world', edits));
});

ok('示例数据：状态分布与交叉验证一致', function () {
  var r = E.computeAnnotations(SAMPLE.initialText, SAMPLE.comments, SAMPLE.edits);
  assert.strictEqual(r.finalText, E.applyEditsToText(SAMPLE.initialText, SAMPLE.edits));
  var byId = {};
  r.annotations.forEach(function (a) { byId[a.id] = a; });
  assert.strictEqual(byId.m1.status, 'resolved');
  assert.strictEqual(byId.m2.status, 'pending');
  assert.strictEqual(byId.m3.status, 'invalid');
  assert.strictEqual(byId.m4.status, 'resolved');
  assert.strictEqual(byId.m5.status, 'pending');
  SAMPLE.comments.forEach(function (c) {
    var exp = expectedAnnotation(SAMPLE.initialText, c, SAMPLE.edits);
    var act = byId[c.id];
    assert.strictEqual(act.status, exp.status, c.id + ' 状态');
    if (exp.status !== 'invalid') {
      assert.strictEqual(act.start, exp.start, c.id + ' start');
      assert.strictEqual(act.end, exp.end, c.id + ' end');
    }
  });
});

/* ---------- 随机化一致性测试（引擎 vs 独立实现） ---------- */
console.log('随机化一致性测试:');

// 简单可复现的伪随机数
function rng(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

ok('500 组随机文档/批注/编辑：最终文本与每条批注映射均一致', function () {
  var alphabet = 'abcXYZ01 \n';
  for (var t = 0; t < 500; t++) {
    var rand = rng(t * 2654435761 + 7);
    var n = 1 + Math.floor(rand() * 60);
    var text = '';
    for (var i = 0; i < n; i++) text += alphabet[Math.floor(rand() * alphabet.length)];

    var comments = [];
    for (var ci = 0; ci < 4; ci++) {
      var s = Math.floor(rand() * (text.length + 1));
      var e2 = s + Math.floor(rand() * (text.length - s + 1));
      comments.push({ id: 'c' + ci, content: '', start: s, end: e2 });
    }

    var edits = [];
    var cur = text;
    for (var ei = 0; ei < 12; ei++) {
      var kind = Math.floor(rand() * 4);
      var len = cur.length;
      if (kind === 0 || len === 0) {
        var pos = Math.floor(rand() * (len + 1));
        var ins = '';
        for (var k = 0; k < 1 + Math.floor(rand() * 5); k++) {
          ins += alphabet[Math.floor(rand() * alphabet.length)];
        }
        edits.push({ type: 'insert', pos: pos, text: ins });
      } else if (kind === 1) {
        var ds = Math.floor(rand() * len);
        var de = ds + 1 + Math.floor(rand() * (len - ds));
        edits.push({ type: 'delete', start: ds, end: de });
      } else if (kind === 2) {
        var rs = Math.floor(rand() * len);
        var re = rs + 1 + Math.floor(rand() * (len - rs));
        var rep = '';
        for (var k2 = 0; k2 < Math.floor(rand() * 5); k2++) {
          rep += alphabet[Math.floor(rand() * alphabet.length)];
        }
        edits.push({ type: 'replace', start: rs, end: re, text: rep });
      } else {
        var ms = Math.floor(rand() * len);
        var me = ms + 1 + Math.floor(rand() * (len - ms));
        var restLen = len - (me - ms);
        edits.push({ type: 'move', start: ms, end: me, to: Math.floor(rand() * (restLen + 1)) });
      }
      cur = E.applyEditsToText(cur, [edits[edits.length - 1]]);
    }

    var r = E.computeAnnotations(text, comments, edits);
    assert.strictEqual(r.finalText, cur, 'seed=' + t + ' 最终文本不一致');
    comments.forEach(function (c, idx) {
      var exp = expectedAnnotation(text, c, edits);
      var act = r.annotations[idx];
      assert.strictEqual(act.status, exp.status, 'seed=' + t + ' ' + c.id + ' 状态');
      if (exp.status !== 'invalid') {
        assert.strictEqual(act.start, exp.start, 'seed=' + t + ' ' + c.id + ' start');
        assert.strictEqual(act.end, exp.end, 'seed=' + t + ' ' + c.id + ' end');
        assert.strictEqual(act.text, r.finalText.slice(act.start, act.end));
      }
    });
  }
});

console.log('\n全部通过，共 ' + passed + ' 项。');
