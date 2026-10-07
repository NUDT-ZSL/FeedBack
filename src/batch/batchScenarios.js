import { initialStudioState, reduceStudio, invariantReport, getCurrentWork, getSavedWorks, } from '../store/lanternStore';
const stroke = (color, seed) => ({
    points: [
        { x: 100 + seed, y: 100 },
        { x: 150 + seed, y: 150 },
        { x: 200 + seed, y: 120 },
    ],
    color,
    radius: 6,
});
const line = (color, seed) => ({
    start: { x: 80 + seed, y: 80 },
    end: { x: 300 - seed, y: 300 },
    color,
    radius: 4,
});
class Harness {
    constructor() {
        this.state = initialStudioState;
        this.counter = 0;
        this.ids = {
            workId: () => `work_${++this.counter}`,
            randomId: () => `R${String(this.counter).padStart(4, '0')}`,
            now: () => 1700000000000 + this.counter * 1000,
        };
        this.violations = [];
    }
    dispatch(action) {
        this.state = reduceStudio(this.state, action, this.ids);
        this.violations.push(...invariantReport(this.state));
    }
    get current() {
        return getCurrentWork(this.state);
    }
    get saved() {
        return getSavedWorks(this.state);
    }
    get invariantViolations() {
        return this.violations;
    }
}
const scenarioCreateSwitch = (h, check) => {
    h.dispatch({ type: 'newWork' });
    h.dispatch({ type: 'setSkeleton', skeletonId: 'rabbit' });
    h.dispatch({ type: 'setSilk', silkId: 'peach' });
    h.dispatch({ type: 'commitStroke', stroke: stroke('#c04040', 0) });
    const firstId = h.state.currentId;
    const firstCreatedAt = h.current.createdAt;
    h.dispatch({ type: 'newWork' });
    h.dispatch({ type: 'setSkeleton', skeletonId: 'lotus' });
    h.dispatch({ type: 'setSilk', silkId: 'bamboo' });
    h.dispatch({ type: 'commitStroke', stroke: stroke('#2e8b57', 10) });
    h.dispatch({ type: 'commitLine', line: line('#ffd700', 5) });
    const secondId = h.state.currentId;
    check('两件作品各自拥有独立身份', firstId !== secondId, `${firstId} vs ${secondId}`);
    check('第二件作品骨架/纱色独立', h.current.skeleton === 'lotus' && h.current.silkColor === 'bamboo');
    h.dispatch({ type: 'switchWork', id: firstId });
    const back = h.current;
    check('切回第一件后骨架保留', back.skeleton === 'rabbit');
    check('切回第一件后纱色保留', back.silkColor === 'peach');
    check('切回第一件后笔触保留', back.strokes.length === 1 && back.strokes[0].color === '#c04040');
    check('切回第一件后无第二件的直线', back.lines.length === 0);
    check('创建时间随作品保留', back.createdAt === firstCreatedAt);
    h.dispatch({ type: 'commitStroke', stroke: stroke('#1a1a1a', 20) });
    h.dispatch({ type: 'switchWork', id: secondId });
    h.dispatch({ type: 'switchWork', id: firstId });
    check('来回切换后第一件累计两笔', h.current.strokes.length === 2);
    h.dispatch({ type: 'switchWork', id: secondId });
    check('第二件内容未被串染', h.current.strokes.length === 1 && h.current.lines.length === 1);
};
const scenarioTempStrokeGuard = (h, check) => {
    h.dispatch({ type: 'newWork' });
    h.dispatch({ type: 'setSkeleton', skeletonId: 'palace' });
    h.dispatch({ type: 'setSilk', silkId: 'moon' });
    const aId = h.state.currentId;
    h.dispatch({ type: 'newWork' });
    h.dispatch({ type: 'setSkeleton', skeletonId: 'rabbit' });
    h.dispatch({ type: 'setSilk', silkId: 'goose' });
    const bId = h.state.currentId;
    h.dispatch({ type: 'switchWork', id: aId });
    const inFlight = stroke('#ff6b6b', 30);
    h.dispatch({ type: 'switchWork', id: bId });
    h.dispatch({ type: 'commitStroke', stroke: inFlight, workId: aId });
    check('进行中的笔触仍归属原作品', h.state.works[aId].strokes.length === 1);
    check('当前作品未被临时笔触污染', h.state.works[bId].strokes.length === 0);
};
const scenarioSaveWall = (h, check) => {
    h.dispatch({ type: 'newWork' });
    h.dispatch({ type: 'setSkeleton', skeletonId: 'rabbit' });
    h.dispatch({ type: 'setSilk', silkId: 'lake' });
    h.dispatch({ type: 'commitStroke', stroke: stroke('#c04040', 0) });
    const id = h.state.currentId;
    h.dispatch({ type: 'saveCurrent' });
    check('未点亮时保存被拒绝', h.saved.length === 0);
    h.dispatch({ type: 'setLit', isLit: true });
    h.dispatch({ type: 'saveCurrent' });
    check('点亮后保存上墙', h.saved.length === 1 && h.saved[0].id === id);
    h.dispatch({ type: 'commitStroke', stroke: stroke('#2a52be', 40) });
    h.dispatch({ type: 'saveCurrent' });
    check('重复保存不新增条目', h.saved.length === 1);
    check('花灯墙反映最新笔触', h.saved[0].strokes.length === 2);
    check('花灯墙条目与当前作品同一份状态', h.saved[0] === h.current);
};
const scenarioDeleteClear = (h, check) => {
    h.dispatch({ type: 'newWork' });
    h.dispatch({ type: 'setSkeleton', skeletonId: 'lotus' });
    h.dispatch({ type: 'setSilk', silkId: 'lotusRoot' });
    h.dispatch({ type: 'setLit', isLit: true });
    h.dispatch({ type: 'saveCurrent' });
    const aId = h.state.currentId;
    h.dispatch({ type: 'newWork' });
    h.dispatch({ type: 'setSkeleton', skeletonId: 'palace' });
    h.dispatch({ type: 'setSilk', silkId: 'peach' });
    h.dispatch({ type: 'setLit', isLit: true });
    h.dispatch({ type: 'saveCurrent' });
    const bId = h.state.currentId;
    check('两盏灯均已上墙', h.saved.length === 2);
    h.dispatch({ type: 'removeWork', id: bId });
    check('删除当前作品后花灯墙同步移除', h.saved.length === 1 && h.saved[0].id === aId);
    check('删除后当前项不悬空', h.state.currentId === aId && h.current !== null);
    h.dispatch({ type: 'clearCurrent' });
    check('清空已上墙作品即从花灯墙移除', h.saved.length === 0);
    check('清空后当前项仍不悬空', h.current === null || h.state.works[h.state.currentId] !== undefined);
    h.dispatch({ type: 'newWork' });
    h.dispatch({ type: 'setSkeleton', skeletonId: 'rabbit' });
    h.dispatch({ type: 'setSilk', silkId: 'bamboo' });
    h.dispatch({ type: 'commitStroke', stroke: stroke('#8b4513', 50) });
    const cId = h.state.currentId;
    h.dispatch({ type: 'clearCurrent' });
    const cleared = h.state.works[cId];
    check('清空未上墙作品保留其身份', cleared !== undefined && cleared.id === cId);
    check('清空后骨架/纱色/笔触归零', cleared.skeleton === null && cleared.silkColor === null && cleared.strokes.length === 0);
    check('清空后创建时间保留', cleared.createdAt === h.current.createdAt);
};
const scenarioDrawGuards = (h, check) => {
    h.dispatch({ type: 'newWork' });
    h.dispatch({ type: 'commitStroke', stroke: stroke('#c04040', 0) });
    check('未选骨架时不能落笔', h.current.strokes.length === 0);
    h.dispatch({ type: 'setSkeleton', skeletonId: 'rabbit' });
    h.dispatch({ type: 'commitStroke', stroke: stroke('#c04040', 0) });
    check('未选纱色时不能落笔', h.current.strokes.length === 0);
    h.dispatch({ type: 'setSilk', silkId: 'peach' });
    h.dispatch({ type: 'commitStroke', stroke: stroke('#c04040', 0) });
    check('骨架与纱色齐备后可落笔', h.current.strokes.length === 1);
    h.dispatch({ type: 'setSilk', silkId: 'moon' });
    h.dispatch({ type: 'commitStroke', stroke: stroke('#1a1a1a', 5) });
    check('更换纱色后仍可继续绘制', h.current.strokes.length === 2 && h.current.silkColor === 'moon');
};
const scenarioManyWorks = (h, check) => {
    const total = 30;
    const ids = [];
    for (let i = 0; i < total; i++) {
        h.dispatch({ type: 'newWork' });
        h.dispatch({ type: 'setSkeleton', skeletonId: ['rabbit', 'lotus', 'palace'][i % 3] });
        h.dispatch({ type: 'setSilk', silkId: ['peach', 'bamboo', 'moon', 'goose', 'lotusRoot', 'lake'][i % 6] });
        h.dispatch({ type: 'commitStroke', stroke: stroke('#c04040', i) });
        if (i % 2 === 0) {
            h.dispatch({ type: 'setLit', isLit: true });
            h.dispatch({ type: 'saveCurrent' });
        }
        ids.push(h.state.currentId);
    }
    check('30 件作品全部建立', h.state.order.length === total);
    check('上墙数量符合预期', h.saved.length === total / 2);
    for (let i = 0; i < total; i += 7) {
        h.dispatch({ type: 'switchWork', id: ids[i] });
        const w = h.current;
        check(`第 ${i + 1} 件作品切换后内容一一对应`, w.id === ids[i] && w.strokes.length === 1 && w.strokes[0].points[0].x === 100 + i);
    }
    const removed = ids.filter((_, i) => i % 3 === 0);
    for (const id of removed) {
        h.dispatch({ type: 'removeWork', id });
    }
    check('批量删除后数量正确', h.state.order.length === total - removed.length);
    check('批量删除后当前项不悬空', h.state.currentId === null || h.state.works[h.state.currentId] !== undefined);
    check('花灯墙与作品一一对应', h.saved.every((w) => h.state.works[w.id] === w) &&
        h.saved.length === h.state.order.filter((id) => h.state.works[id].savedAt !== null).length);
};
const SCENARIOS = [
    { title: '多作品创建与来回切换', run: scenarioCreateSwitch },
    { title: '切换中的临时笔触归属', run: scenarioTempStrokeGuard },
    { title: '保存与花灯墙同步', run: scenarioSaveWall },
    { title: '删除与清空的同步', run: scenarioDeleteClear },
    { title: '绘制前置条件守卫', run: scenarioDrawGuards },
    { title: '大量作品下的一致性', run: scenarioManyWorks },
];
export function runBatchChecks() {
    const scenarios = [];
    let totalChecks = 0;
    let passedChecks = 0;
    for (const { title, run } of SCENARIOS) {
        const h = new Harness();
        const checks = [];
        const check = (name, cond, detail = '') => {
            checks.push({ name, passed: cond, detail });
        };
        run(h, check);
        const invariantViolations = h.invariantViolations;
        const passed = checks.every((c) => c.passed) && invariantViolations.length === 0;
        totalChecks += checks.length;
        passedChecks += checks.filter((c) => c.passed).length;
        scenarios.push({ title, checks, invariantViolations, passed });
    }
    return {
        scenarios,
        totalChecks,
        passedChecks,
        passed: scenarios.every((s) => s.passed),
    };
}
