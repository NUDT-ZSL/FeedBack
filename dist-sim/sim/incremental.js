/**
 * 增量重推：调整波次/敌人参数后，只重算受影响的时间区间。
 *
 * 原理：
 *   - 整体推演时按固定间隔保存引擎状态检查点（含 RNG 状态）；
 *   - 新旧配置做结构化比较，定位最早受影响的时刻：
 *       * 全局字段（输出策略、机制参数等）变化 -> 从 0 重推；
 *       * 第 i 波配置变化 -> 从第 i 波开始时刻重推；
 *       * 波次新增/删除 -> 从第一个发生差异的波次开始时刻重推；
 *   - 从不晚于该时刻的最近检查点恢复，推演到结束，再与旧结果中
 *     早于检查点的事件/曲线拼接。
 *
 * 因引擎确定性（固定步长 + 种子化 RNG + 可恢复状态），增量拼接结果
 * 与对新配置整体重推严格一致（selfcheck.ts 负责回归验证）。
 */
import { Engine } from './engine.js';
import { buildResult } from './result.js';
export class IncrementalRunner {
    constructor(checkpointEveryMs = 5000) {
        this.config = null;
        this.checkpoints = [];
        this.events = [];
        this.curve = [];
        this.checkpointEveryMs = checkpointEveryMs;
    }
    runFull(config, configHash) {
        this.config = config;
        this.checkpoints = [];
        const engine = new Engine(config);
        this.checkpoints.push({
            t: 0,
            state: engine.snapshot(),
            eventsCount: 0,
            curveCount: 0
        });
        while (!engine.done) {
            engine.step();
            const t = engine.timeMs;
            if (t % this.checkpointEveryMs === 0) {
                this.checkpoints.push({
                    t,
                    state: engine.snapshot(),
                    eventsCount: engine.events.length,
                    curveCount: engine.curve.length
                });
            }
        }
        this.events = [...engine.events];
        this.curve = [...engine.curve];
        return buildResult(config, this.events, this.curve, configHash);
    }
    applyChange(next, configHash) {
        if (!this.config) {
            return {
                result: this.runFull(next, configHash),
                affectedFromMs: 0,
                reusedUntilMs: 0,
                recomputedRangeMs: [0, 0]
            };
        }
        const affectedFromMs = computeAffectedFromMs(this.config, next, this.events);
        if (affectedFromMs === Infinity) {
            return {
                result: buildResult(next, this.events, this.curve, configHash),
                affectedFromMs,
                reusedUntilMs: this.curve.length > 0 ? this.curve[this.curve.length - 1].t : 0,
                recomputedRangeMs: [0, 0]
            };
        }
        let cp = this.checkpoints[0];
        for (const c of this.checkpoints) {
            if (c.t <= affectedFromMs)
                cp = c;
            else
                break;
        }
        const keptEvents = this.events.slice(0, cp.eventsCount);
        const keptCurve = this.curve.slice(0, cp.curveCount);
        const engine = new Engine(next, cp.state);
        const newCheckpoints = this.checkpoints.filter(c => c.t <= cp.t);
        while (!engine.done) {
            engine.step();
            const t = engine.timeMs;
            if (t % this.checkpointEveryMs === 0) {
                newCheckpoints.push({
                    t,
                    state: engine.snapshot(),
                    eventsCount: keptEvents.length + engine.events.length,
                    curveCount: keptCurve.length + engine.curve.length
                });
            }
        }
        const endMs = engine.timeMs;
        this.config = next;
        this.checkpoints = newCheckpoints;
        this.events = [...keptEvents, ...engine.events];
        this.curve = [...keptCurve, ...engine.curve];
        return {
            result: buildResult(next, this.events, this.curve, configHash),
            affectedFromMs,
            reusedUntilMs: cp.t,
            recomputedRangeMs: [cp.t, endMs]
        };
    }
}
function computeAffectedFromMs(oldConfig, newConfig, oldEvents) {
    const { waves: oldWaves, ...oldRest } = oldConfig;
    const { waves: newWaves, ...newRest } = newConfig;
    if (stableJson(oldRest) !== stableJson(newRest))
        return 0;
    const common = Math.min(oldWaves.length, newWaves.length);
    for (let i = 0; i < common; i++) {
        if (stableJson(oldWaves[i]) !== stableJson(newWaves[i])) {
            return waveStartMs(oldEvents, i + 1);
        }
    }
    if (oldWaves.length !== newWaves.length) {
        return waveStartMs(oldEvents, common + 1);
    }
    return Infinity;
}
function waveStartMs(events, wave) {
    const start = events.find(e => e.type === 'wave-start' && e.wave === wave);
    if (start)
        return start.t;
    const last = events[events.length - 1];
    return last ? last.t : 0;
}
function stableJson(value) {
    return JSON.stringify(value);
}
