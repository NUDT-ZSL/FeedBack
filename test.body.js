
let pass=0, fail=0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.log("FAIL:", name)); };

// 1. 种子目标排期：30+45+40+30=145 天，<=180 可行
let g = state.goals[0];
let a = analyze(g);
t("seed finish=145", a.finish === 145);
t("seed feasible", a.overrun <= 0);
t("seed all critical (linear chain)", g.milestones.every(m => m._critical || m.status==="cancelled"));

// 2. 延期 → 重算后续路径，超出周期 → 不可行 + 建议
const m2 = g.milestones[1];
m2.status = "delayed"; m2.delayDays = 50;
a = analyze(g);
t("delay recomputes finish=195", a.finish === 195);
t("overrun flagged", a.overrun === 15);
t("err issue raised", a.issues.some(i => i.level==="err" && i.text.includes("不可行")));
t("extend suggestion offered", a.issues.some(i => i.action && i.action.fn==="extendDeadline"));

// 3. 取消中间阶段 → 依赖它的阶段给出警告建议
m2.status = "cancelled"; m2.delayDays = 0;
a = analyze(g);
t("cancel shrinks finish=100", a.finish === 100);
t("cancelled-dep warning", a.issues.some(i => i.level==="warn" && i.text.includes("已取消")));
// 执行建议动作：移除依赖
const warn = a.issues.find(i => i.action && i.action.fn==="removeDep");
removeDep.apply(null, warn.action.args);
t("dep removed", g.milestones[2].deps.length === 0);

// 4. 循环依赖检测
const m3 = g.milestones[2], m4 = g.milestones[3];
m3.deps = [m4.id]; m4.deps = [m3.id];
a = analyze(g);
t("cycle detected", a.cyclic.length === 2);
t("cycle issue", a.issues.some(i => i.text.includes("循环依赖")));
m3.deps = []; m4.deps = [m3.id];

// 5. 手动调整顺序（下移 m1 越过依赖它的 m2）→ 依赖重接
m2.status = "pending"; m2.deps = [g.milestones[0].id];
moveMilestone(g, g.milestones[0].id, 1);
t("order swapped", g.order[0] === m2.id && g.order[1] === g.milestones[0].id);
t("deps rewired", g.milestones[0].deps.includes(m2.id) && m2.deps.length === 0);
a = analyze(g);
t("reorder recomputes (m2:45 -> m1:75, m3/m4 分支)", a.finish === 75);

// 6. 修改时长 → 同步重算
m2.duration = 100;
a = analyze(g);
t("duration change propagates", a.finish === 130 && a.overrun === -50);

// 7. 并行分支：两条路径取最长
m3.deps = [g.milestones[0].id]; m4.deps = [g.milestones[0].id]; // 都挂在 m1(第130天完成) 之后
a = analyze(g);
t("parallel paths take max", a.finish === 130 + Math.max(40, 30));
t("slack on shorter branch", g.milestones[3]._slack === 10);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
