const fs = require("fs");
const src = fs.readFileSync("app.extracted.js", "utf8");
const seg = src.slice(src.indexOf("// ---------- 锚点定位"), src.indexOf("// ---------- 编辑器渲染"));
eval(seg);

const doc = "一、背景\n随着远程办公的普及，团队成员的日程协调成本显著上升。现有的日历工具缺少跨时区智能推荐能力。\n二、目标\n将会议安排的平均耗时从 15 分钟降低到 3 分钟以内。";
const t1 = "日程协调成本显著上升";
const s1 = doc.indexOf(t1);
const a1 = buildAnchor(doc, s1, s1 + t1.length);

// 场景1：前文插入文字，锚点应平移且状态 ok
const doc2 = doc.replace("一、背景", "一、背景（2026年9月修订版，新增说明文字）");
const r1 = resolveAnchor(doc2, a1, { start: s1, end: s1 + t1.length });
console.log("场景1 平移:", r1.status, doc2.slice(r1.start, r1.end) === t1 ? "定位正确" : "定位错误");

// 场景2：原文被改写 -> shifted 或 orphan，并给出原因
const doc3 = doc.replace(t1, "日程协同开销大幅增加");
const r2 = resolveAnchor(doc3, a1, { start: s1, end: s1 + t1.length });
console.log("场景2 改写:", r2.status, "|", r2.reason, "| 命中:", r2.start != null ? doc3.slice(r2.start, r2.end) : "-");

// 场景3：整段删除 -> orphan + 原因
const doc4 = doc.replace("随着远程办公的普及，团队成员的日程协调成本显著上升。现有的日历工具缺少跨时区智能推荐能力。", "略。");
const r3 = resolveAnchor(doc4, a1, { start: s1, end: s1 + t1.length });
console.log("场景3 删除:", r3.status, "|", r3.reason);

// 场景4：重复文本，靠上下文消歧
const doc5 = "目标。降低成本，提升效率。\n中间段落。\n降低成本，提升效率。结尾。";
const t5 = "降低成本，提升效率。";
const s5 = doc5.lastIndexOf(t5);
const a5 = buildAnchor(doc5, s5, s5 + t5.length);
const doc6 = doc5.replace("中间段落。", "中间段落被大幅扩充，插入了很多新的内容。");
const r5 = resolveAnchor(doc6, a5, { start: s5, end: s5 + t5.length });
console.log("场景4 消歧:", r5.status, r5.start === doc6.lastIndexOf(t5) ? "选中第二处(正确)" : "选错位置");

// 场景5：同一文本上多条意见一起重定位
const st = { docText: doc2, comments: [
  { anchor: a1, location: { start: s1, end: s1 + t1.length } },
  { anchor: buildAnchor(doc, s1, s1 + 4), location: { start: s1, end: s1 + 4 } }
]};
// 模拟 reanchorAll
for (const c of st.comments) {
  const r = resolveAnchor(st.docText, c.anchor, c.location);
  c.location = r.status === "orphan" ? null : { start: r.start, end: r.end };
  c.anchorStatus = r.status;
}
console.log("场景5 批量:", st.comments.map(c => c.anchorStatus + "@" + c.location.start).join(", "));