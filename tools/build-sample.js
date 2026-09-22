/*
 * build-sample.js — 生成演示数据 data/sample.js
 * 通过子串查找自动计算字符偏移，保证数据自洽。
 * 运行: node tools/build-sample.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const paragraphs = [
  '产品需求文档（V1）',
  '本系统用于管理在线课程的报名与排课。学员可以浏览课程目录，选择感兴趣的课程并提交报名申请。',
  '报名成功后，系统会自动发送确认邮件，并将学员加入对应班级的花名册。',
  '管理员可以手动调整班级容量，必要时将超额报名的学员移入候补名单。',
  '所有操作都会记录审计日志，便于后续追溯。'
];
const initialText = paragraphs.join('\n\n');

function mustFind(haystack, needle, from) {
  const i = haystack.indexOf(needle, from || 0);
  if (i === -1) throw new Error('找不到子串: ' + needle);
  return i;
}

// 批注：锚定初始文档中的子串
const commentDefs = [
  { id: 'm1', content: '这里要不要支持按分类筛选课程？', anchor: '浏览课程目录' },
  { id: 'm2', content: '确认邮件的模板需要法务审核。', anchor: '自动发送确认邮件' },
  { id: 'm3', content: '班级容量建议做成全局配置，而不是手动调整。', anchor: '手动调整班级容量' },
  { id: 'm4', content: '候补名单的排序规则需要明确。', anchor: '候补名单' },
  { id: 'm5', content: '审计日志保留多久？建议至少一年。', anchor: '记录审计日志' }
];
const comments = commentDefs.map(c => {
  const start = mustFind(initialText, c.anchor);
  return { id: c.id, content: c.content, start: start, end: start + c.anchor.length };
});

// 编辑操作：基于“当前文本”用子串定位，再换算成数值偏移
const edits = [];
let doc = initialText;

function doInsert(before, text) {
  const pos = mustFind(doc, before);
  edits.push({ type: 'insert', pos: pos, text: text });
  doc = doc.slice(0, pos) + text + doc.slice(pos);
}
function doDelete(needle) {
  const start = mustFind(doc, needle);
  edits.push({ type: 'delete', start: start, end: start + needle.length });
  doc = doc.slice(0, start) + doc.slice(start + needle.length);
}
function doReplace(needle, text) {
  const start = mustFind(doc, needle);
  edits.push({ type: 'replace', start: start, end: start + needle.length, text: text });
  doc = doc.slice(0, start) + text + doc.slice(start + needle.length);
}
function doMove(needle, before) {
  const start = mustFind(doc, needle);
  const rest = doc.slice(0, start) + doc.slice(start + needle.length);
  const to = mustFind(rest, before);
  edits.push({ type: 'move', start: start, end: start + needle.length, to: to });
  doc = rest.slice(0, to) + needle + rest.slice(to);
}

// 1. 在第二段“报名申请。”后补一句（不影响任何批注）
doReplace('提交报名申请。', '提交报名申请。申请提交后可在个人中心查看进度。');
// 2. 把“确认邮件”改为“确认短信”（与 m2 锚点部分重叠 -> 待确认）
doReplace('确认邮件', '确认短信');
// 3. 删除“管理员可以手动调整班级容量，”（m3 锚点整体被删 -> 失效）
doDelete('管理员可以手动调整班级容量，');
// 4. 把候补名单一句移到段首（m4 锚点整体移动 -> 已解决，位置更新）
doMove('必要时将超额报名的学员移入候补名单。', '所有操作');
// 5. 在 m5 锚点内部插入“详细的”（锚点被改写 -> 待确认）
doInsert('审计日志', '详细的');

const sample = { initialText: initialText, comments: comments, edits: edits };

const out = '/* 由 tools/build-sample.js 生成，请勿手改 */\n' +
  'var SAMPLE_DATA = ' + JSON.stringify(sample, null, 2) + ';\n' +
  'if (typeof window !== "undefined") { window.SAMPLE_DATA = SAMPLE_DATA; }\n' +
  'if (typeof module === "object" && module.exports) { module.exports = SAMPLE_DATA; }\n';
const dest = path.join(__dirname, '..', 'data', 'sample.js');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out, 'utf8');
console.log('已生成 ' + dest + '（最终文档 ' + doc.length + ' 字）');
