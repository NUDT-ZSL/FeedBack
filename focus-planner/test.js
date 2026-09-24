'use strict';
var Core = require('./core.js');
var failures = 0;
function ok(cond, name) {
  if (cond) { console.log('PASS  ' + name); }
  else { failures++; console.log('FAIL  ' + name); }
}
function plan(doc) { return Core.computePlan(Core.normalize(doc)); }

// 基础结构：root -> [secA(a,b,c), secB(d,e)], 全部默认顺序 a b c d e
function baseDoc() {
  return {
    root: 'root', initialFocus: 'a',
    containers: [{ id: 'root', label: '表单' }, { id: 'secA', label: 'A区' }, { id: 'secB', label: 'B区' }],
    children: { root: ['secA', 'secB'], secA: ['a', 'b', 'c'], secB: ['d', 'e'] },
    elements: [
      { id: 'a', label: '甲', required: true }, { id: 'b', label: '乙' },
      { id: 'c', label: '丙', required: true }, { id: 'd', label: '丁' }, { id: 'e', label: '戊' }
    ],
    constraints: []
  };
}

// 1. 默认顺序 = 深度优先
var p1 = plan(baseDoc());
ok(p1.order.join(',') === 'a,b,c,d,e', '默认顺序按层级深度优先推导');
ok(p1.path.join(',') === 'a,b,c,d,e' && p1.complete, '无约束时路径覆盖全部元素');
ok(p1.problems.length === 0, '无约束时必需元素全部可达');

// 2. 同源冲突：高优先级生效，低优先级标记覆盖
var d2 = baseDoc();
d2.constraints = [
  { id: 'j1', from: 'a', to: 'd', priority: 1 },
  { id: 'j2', from: 'a', to: 'c', priority: 5 }
];
var p2 = plan(d2);
ok(p2.edges.a.to === 'c' && p2.edges.a.via === 'j2', '同源冲突按优先级取舍');
ok(p2.overridden.length === 1 && p2.overridden[0].constraint.id === 'j1' && p2.overridden[0].kind === 'conflict', '被覆盖约束有标记与原因');

// 3. 循环消解：b->d, d->b 成环困住 c/e，断开低优先级边
var d3 = baseDoc();
d3.constraints = [
  { id: 'k1', from: 'b', to: 'd', priority: 9 },
  { id: 'k2', from: 'd', to: 'b', priority: 2 }
];
var p3 = plan(d3);
ok(p3.path.join(',') === 'a,b,d,e', '循环断开后保留可行路径');
ok(p3.overridden.some(function (o) { return o.constraint.id === 'k2' && o.kind === 'cycle'; }), '环内最低优先级约束被断开并标记');
ok(new Set(p3.path).size === p3.path.length, '路径不重复进入同一元素');

// 4. 必需元素不可达：报告断裂段与原因
var d4 = baseDoc();
d4.constraints = [{ id: 'x1', from: 'a', to: 'd', priority: 1 }];
var p4 = plan(d4);
ok(p4.problems.length === 1 && p4.problems[0].element === 'c', '识别出不可达的必需元素');
ok(/断裂段/.test(p4.problems[0].reason) && /x1/.test(p4.problems[0].reason), '原因指出造成断裂的约束');
ok(p4.problems[0].cause === 'x1', '断裂原因关联到具体约束 id');

// 5. 删除问题约束后恢复可达（模拟用户修改）
var d5 = baseDoc();
d5.constraints = [];
var p5 = plan(d5);
ok(p5.problems.length === 0 && p5.complete, '删除约束后必需元素恢复可达');

// 6. 非法约束端点进入 invalid，不参与计算
var d6 = baseDoc();
d6.constraints = [{ id: 'bad', from: 'a', to: 'ghost', priority: 1 }];
var p6 = plan(d6);
ok(p6.invalid.length === 1 && /终点/.test(p6.invalid[0].reason), '非法端点约束被拦截并给出原因');
ok(p6.complete, '非法约束不影响正常路径');

// 7. 初始焦点之前的必需元素不可达，必须报告
var d7 = baseDoc();
d7.initialFocus = 'c';
var p7 = plan(d7);
ok(p7.path.join(',') === 'c,d,e', '从初始焦点出发线性推进');
ok(p7.problems.some(function (p) { return p.element === 'a'; }), '初始焦点之前的必需元素被报告为不可达');

// 8. 跳转约束与默认顺序衔接：a->d 后从 d 继续默认推进
var d8 = baseDoc();
d8.constraints = [{ id: 'j', from: 'a', to: 'd', priority: 1 }, { id: 'back', from: 'e', to: 'b', priority: 1 }];
var p8 = plan(d8);
ok(p8.path.join(',') === 'a,d,e,b,c', '跳转后沿默认顺序继续且可回到被跳过区间');
ok(p8.complete && p8.problems.length === 0, '组合跳转下全部可达');

console.log(failures === 0 ? '\n全部测试通过' : '\n有 ' + failures + ' 项失败');
process.exit(failures === 0 ? 0 : 1);
