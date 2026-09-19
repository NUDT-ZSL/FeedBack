/* test.js — 需求 1~6 的离线验收测试(node test.js) */
const C = require('./core.js');
let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ' :: ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function near(a, b, eps) {
  eps = eps || 1e-6;
  return Math.abs(a[0]-b[0])<eps && Math.abs(a[1]-b[1])<eps && Math.abs(a[2]-b[2])<eps;
}
const CAM = { target: [0,0,0], yaw: 0, pitch: 20, distance: 30 };
const VP = { width: 800, height: 600, fov: 60 };
function viewOf(s, id) { return C.computeView(s, CAM, VP).annotations.find(a => a.id === id); }

/* 需求1:对象/标注维护与校验 */
t('1.1 正常登记对象与标注', () => {
  const s = C.createState();
  assert(C.addObject(s, {id:'room', size:[10,3,8]}).ok);
  assert(C.addObject(s, {id:'desk', parentId:'room', position:[1,0,2], size:[2,1,1]}).ok);
  assert(C.addAnnotation(s, {id:'n1', objectId:'desk', anchor:[0,0.5,0], text:'桌面划痕'}, '审阅人A').ok);
});
t('1.2 重复对象标识被拒绝并指出位置', () => {
  const s = C.createState();
  C.addObject(s, {id:'room', size:[10,3,8]});
  const r = C.addObject(s, {id:'room', size:[1,1,1]});
  assert(!r.ok && r.error.includes('重复') && r.error.includes('room'), r.error);
});
t('1.3 非正尺寸被拒绝并指出分量与位置', () => {
  const s = C.createState();
  C.addObject(s, {id:'room', size:[10,3,8]});
  const r = C.addObject(s, {id:'bad', parentId:'room', size:[2,-1,3]});
  assert(!r.ok && r.error.includes('非正') && r.error.includes('第 2 个分量') && r.error.includes('room'), r.error);
});
t('1.4 标注挂在不存在的对象上被拒绝', () => {
  const s = C.createState();
  const r = C.addAnnotation(s, {id:'n1', objectId:'ghost', anchor:[0,0,0], text:'x'}, 'A');
  assert(!r.ok && r.error.includes('ghost'), r.error);
});

/* 需求2:关系与成环检测 */
t('2.1 引用不存在的标注被拒绝并给出链条', () => {
  const s = C.createState();
  C.addObject(s, {id:'o', size:[1,1,1]});
  C.addAnnotation(s, {id:'a', objectId:'o', anchor:[0,0,0], text:'a'}, 'A');
  const r = C.addRelation(s, 'a', 'missing', 'reference');
  assert(!r.ok && r.error.includes('missing') && r.error.includes('a -> missing'), r.error);
});
t('2.2 关系成环被拒绝并给出完整链条', () => {
  const s = C.createState();
  C.addObject(s, {id:'o', size:[1,1,1]});
  ['a','b','c'].forEach(id => C.addAnnotation(s, {id, objectId:'o', anchor:[0,0,0], text:id}, 'A'));
  assert(C.addRelation(s, 'a', 'b', 'reference').ok);
  assert(C.addRelation(s, 'b', 'c', 'dependency').ok);
  const r = C.addRelation(s, 'c', 'a', 'reference');
  assert(!r.ok && r.error.includes('成环') && r.error.includes('a') && r.error.includes('b') && r.error.includes('c'), r.error);
});
t('2.3 自环被拒绝', () => {
  const s = C.createState();
  C.addObject(s, {id:'o', size:[1,1,1]});
  C.addAnnotation(s, {id:'a', objectId:'o', anchor:[0,0,0], text:'a'}, 'A');
  assert(!C.addRelation(s, 'a', 'a', 'dependency').ok);
});

/* 需求3:投影、视窗与遮挡 */
t('3.1 可见标注推出屏幕坐标', () => {
  const s = C.createState();
  C.addObject(s, {id:'o', size:[1,1,1]});
  C.addAnnotation(s, {id:'n', objectId:'o', anchor:[0,0.5,0], text:'t'}, 'A');
  const v = viewOf(s, 'n');
  assert(v.status === 'visible', v.status);
  assert(v.screen[0] > 0 && v.screen[0] < 800 && v.screen[1] > 0 && v.screen[1] < 600);
});
t('3.2 视窗外标注标为 outside 而非隐藏', () => {
  const s = C.createState();
  C.addObject(s, {id:'o', position:[500,0,0], size:[1,1,1]});
  C.addAnnotation(s, {id:'n', objectId:'o', anchor:[0,0,0], text:'t'}, 'A');
  assert(viewOf(s, 'n').status === 'outside');
});
t('3.3 被遮挡标注标为 occluded', () => {
  const s = C.createState();
  C.addObject(s, {id:'front', position:[0,0,15], size:[20,20,1]});
  C.addObject(s, {id:'back', position:[0,0,5], size:[1,1,1]});
  C.addAnnotation(s, {id:'n', objectId:'back', anchor:[0,0,0], text:'t'}, 'A');
  assert(viewOf(s, 'n').status === 'occluded', viewOf(s, 'n').status);
});
t('3.4 相机转动后同一标注状态随视图更新', () => {
  const s = C.createState();
  C.addObject(s, {id:'wall', position:[0,0,15], size:[30,30,1]});
  C.addObject(s, {id:'o', position:[0,0,5], size:[1,1,1]});
  C.addAnnotation(s, {id:'n', objectId:'o', anchor:[0,0,0], text:'t'}, 'A');
  assert(viewOf(s, 'n').status === 'occluded');
  const back = C.computeView(s, {target:[0,0,0], yaw:180, pitch:20, distance:30}, VP);
  assert(back.annotations.find(a => a.id === 'n').status === 'visible');
});

/* 需求4:对象变换带动标注,无关标注不变 */
t('4.1 移动/旋转/缩放对象后锚点随动', () => {
  const s = C.createState();
  C.addObject(s, {id:'o', size:[2,2,2]});
  C.addAnnotation(s, {id:'n', objectId:'o', anchor:[1,0,0], text:'t'}, 'A');
  const before = C.worldAnchor(s, s.annotations.get('n'));
  assert(near(before, [1,0,0]));
  C.transformObject(s, 'o', {position:[10,0,0]});
  assert(near(C.worldAnchor(s, s.annotations.get('n')), [11,0,0]));
  C.transformObject(s, 'o', {position:[0,0,0], rotation:[0,90,0]});
  assert(near(C.worldAnchor(s, s.annotations.get('n')), [0,0,-1], 1e-6));
  C.transformObject(s, 'o', {rotation:[0,0,0], scale:[3,3,3]});
  assert(near(C.worldAnchor(s, s.annotations.get('n')), [3,0,0]));
});
t('4.2 父对象变换沿层级传导,未受影响标注不变', () => {
  const s = C.createState();
  C.addObject(s, {id:'p', size:[10,10,10]});
  C.addObject(s, {id:'c', parentId:'p', position:[1,0,0], size:[1,1,1]});
  C.addObject(s, {id:'other', position:[50,0,0], size:[1,1,1]});
  C.addAnnotation(s, {id:'onC', objectId:'c', anchor:[0,0,0], text:'c'}, 'A');
  C.addAnnotation(s, {id:'onOther', objectId:'other', anchor:[0,0,0], text:'o'}, 'A');
  const before = C.worldAnchor(s, s.annotations.get('onOther')).slice();
  C.transformObject(s, 'p', {position:[0,5,0]});
  assert(near(C.worldAnchor(s, s.annotations.get('onC')), [1,5,0]));
  assert(near(C.worldAnchor(s, s.annotations.get('onOther')), before), '未受影响标注被改变');
});

/* 需求5:删除/改挂时保留证据并标记失效 */
t('5.1 删除对象后标注保留原锚点证据并标记失效', () => {
  const s = C.createState();
  C.addObject(s, {id:'o', position:[3,0,0], size:[2,2,2]});
  C.addAnnotation(s, {id:'n', objectId:'o', anchor:[1,0,0], text:'证据'}, 'A');
  assert(C.deleteObject(s, 'o').ok);
  const ann = s.annotations.get('n');
  assert(ann.invalid && ann.invalid.reason.includes('删除'));
  assert(near(ann.invalid.worldAnchor, [4,0,0]), '证据世界锚点错误');
  assert(near(ann.invalid.localAnchor, [1,0,0]));
  assert(viewOf(s, 'n').status === 'invalid');
  assert(s.log.some(l => l.kind === 'invalid' && l.message.includes('n')), '缺少失效日志');
});
t('5.2 改挂父对象后标注失效且证据不被挪动', () => {
  const s = C.createState();
  C.addObject(s, {id:'p1', size:[5,5,5]});
  C.addObject(s, {id:'p2', position:[100,0,0], size:[5,5,5]});
  C.addObject(s, {id:'o', parentId:'p1', position:[1,0,0], size:[1,1,1]});
  C.addAnnotation(s, {id:'n', objectId:'o', anchor:[0,0,0], text:'t'}, 'A');
  const before = C.worldAnchor(s, s.annotations.get('n')).slice();
  assert(C.reparentObject(s, 'o', 'p2').ok);
  const ann = s.annotations.get('n');
  assert(ann.invalid && ann.invalid.reason.includes('改挂'));
  assert(near(ann.invalid.worldAnchor, before), '证据被挪动');
  assert(near(C.worldAnchor(s, ann), before), '失效标注应冻结在证据位置');
});
t('5.3 改挂成环被拒绝', () => {
  const s = C.createState();
  C.addObject(s, {id:'p', size:[5,5,5]});
  C.addObject(s, {id:'c', parentId:'p', size:[1,1,1]});
  assert(!C.reparentObject(s, 'p', 'c').ok);
});

/* 需求6:多来源冲突保留双方并生成可读记录 */
t('6.1 矛盾锚点/正文保留双方并生成冲突记录', () => {
  const s = C.createState();
  C.addObject(s, {id:'o', size:[1,1,1]});
  C.addAnnotation(s, {id:'n', objectId:'o', anchor:[0,0,0], text:'原始'}, '上游系统');
  const r = C.addAnnotation(s, {id:'n', objectId:'o', anchor:[0.5,0,0], text:'修改后'}, '审阅人B');
  assert(r.ok && r.conflict);
  assert(s.conflicts.length === 1 && s.conflicts[0].annotationId === 'n');
  const ann = s.annotations.get('n');
  assert(ann.versions.length === 2, '未保留双方');
  const rec = s.log.filter(l => l.kind === 'conflict').pop();
  assert(rec && rec.message.includes('上游系统') && rec.message.includes('审阅人B')
    && rec.message.includes('原始') && rec.message.includes('修改后'), rec && rec.message);
});
t('6.2 同源内容一致不产生冲突', () => {
  const s = C.createState();
  C.addObject(s, {id:'o', size:[1,1,1]});
  C.addAnnotation(s, {id:'n', objectId:'o', anchor:[0,0,0], text:'x'}, 'A');
  C.addAnnotation(s, {id:'n', objectId:'o', anchor:[0,0,0], text:'x'}, 'B');
  assert(s.conflicts.length === 0);
});

console.log('---');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
