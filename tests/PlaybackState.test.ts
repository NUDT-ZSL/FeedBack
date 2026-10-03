/**
 * PlaybackState 离线测试（纯状态机 + 手动时钟，无浏览器依赖）
 * 运行：node tests/PlaybackState.test.ts
 */
import { PlaybackState, type PlaybackSnapshot, type Selection } from '../src/PlaybackState.ts';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function approx(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

function assertInvariants(snap: PlaybackSnapshot): boolean {
  const rangeOk = snap.position >= -1e-9 && snap.position <= snap.duration + 1e-9;
  if (!rangeOk) return false;
  if (snap.selection) {
    const s = snap.selection;
    if (s.start < -1e-9 || s.end > snap.duration + 1e-9 || s.end <= s.start) return false;
    if (snap.position < s.start - 1e-6 || snap.position > s.end + 1e-6) return false;
  }
  return true;
}

function harness(startDuration = 10) {
  let now = 0;
  const state = new PlaybackState(() => now);
  const advances: PlaybackSnapshot[] = [];
  state.subscribe(snap => advances.push(snap));
  state.load(startDuration);
  advances.length = 0;
  return {
    state,
    advance: (dt: number) => {
      now += dt;
    },
    now: () => now,
    emitted: () => advances[advances.length - 1],
    clear: () => advances.splice(0, advances.length)
  };
}

// 1. 暂停后拖动进度条再播放（无选区）：从拖动后的位置继续
{
  const h = harness(10);
  h.state.play();
  h.advance(3);
  h.state.pause();
  check('暂停位置记录为听到的位置', approx(h.state.getSnapshot().position, 3));
  h.state.seek(5);
  check('暂停时拖动进度条：时间显示落在拖动位置', approx(h.state.getSnapshot().position, 5));
  check('暂停时拖动：状态仍为暂停', !h.state.getSnapshot().isPlaying);
  h.state.play();
  h.advance(2);
  check('再播放：从拖动后的位置继续', approx(h.state.getSnapshot().position, 7),
    `got ${h.state.getSnapshot().position}`);
}

// 2. 带选区暂停、再拖动进度条：时间始终夹在选区内，再播放仍只播放选区
{
  const h = harness(10);
  h.state.setSelection({ start: 2, end: 4 });
  h.state.play();
  h.advance(1);
  check('选区播放位置落在选区内', approx(h.state.getSnapshot().position, 3));
  h.state.pause();
  h.state.seek(9);
  check('暂停时拖到选区外：位置夹回选区末端', approx(h.state.getSnapshot().position, 4));
  h.state.seek(0);
  check('暂停时拖到选区左侧：位置夹回选区起点', approx(h.state.getSnapshot().position, 2));
  h.state.seek(3.2);
  h.state.play();
  h.advance(0.5);
  const snap = h.state.getSnapshot();
  check('带选区暂停再播放：继续播放且时间在选区内',
    approx(snap.position, 3.7) && snap.position <= snap.selection!.end);
  h.advance(5);
  check('带选区播放不会越过选区末端', approx(h.state.getSnapshot().position, 4));
}

// 3. 带选区暂停再播放，从暂停点继续且范围不丢
{
  const h = harness(10);
  h.state.setSelection({ start: 2, end: 4 });
  h.state.seek(2.5);
  h.state.play();
  h.advance(0.8);
  h.state.pause();
  check('带选区暂停：位置保留在选区内', approx(h.state.getSnapshot().position, 3.3));
  h.state.play();
  h.advance(0.2);
  const snap = h.state.getSnapshot();
  check('带选区继续：仍只播放选区范围',
    !!snap.selection && approx(snap.selection.start, 2) && approx(snap.selection.end, 4) &&
    approx(snap.position, 3.5) && snap.position <= 4);
}

// 4. 建立选区时当前位置在选区外：位置自动夹入选区
{
  const h = harness(10);
  h.state.seek(9);
  h.state.setSelection({ start: 2, end: 4 });
  check('建选区时位置在右侧：夹到末端', approx(h.state.getSnapshot().position, 4));
  h.state.setSelection(null);
  check('清除选区后位置保留', approx(h.state.getSnapshot().position, 4));
  h.state.seek(1);
  h.state.setSelection({ start: 3, end: 6 });
  check('建选区时位置在左侧：夹到起点', approx(h.state.getSnapshot().position, 3));
}

// 5. 停止：选区和时间彻底清空
{
  const h = harness(10);
  h.state.setSelection({ start: 2, end: 4 });
  h.state.play();
  h.advance(1);
  h.state.stop();
  const snap = h.state.getSnapshot();
  check('停止后位置归零', approx(snap.position, 0));
  check('停止后选区清空', snap.selection === null);
  check('停止后为暂停态', !snap.isPlaying);

  h.state.setSelection({ start: 1, end: 2 });
  h.state.stop();
  check('暂停态停止也清空选区', h.state.getSnapshot().selection === null);
}

// 6. 自然结束（非循环）：等同停止，选区不残留
{
  const h = harness(10);
  h.state.setSelection({ start: 2, end: 4 });
  h.state.play();
  h.advance(2);
  h.state.handleEnded();
  const snap = h.state.getSnapshot();
  check('选区自然结束：位置归零', approx(snap.position, 0));
  check('选区自然结束（非循环）：选区清空', snap.selection === null);
  check('选区自然结束：停止播放', !snap.isPlaying);

  const g = harness(10);
  g.state.play();
  g.advance(10);
  g.state.handleEnded();
  check('整曲自然结束：位置归零', approx(g.state.getSnapshot().position, 0));
}

// 7. 循环结束：回到范围起点继续播放
{
  const h = harness(10);
  h.state.setSelection({ start: 2, end: 4 });
  h.state.toggleLoop();
  h.state.play();
  h.advance(2);
  h.state.handleEnded();
  const snap = h.state.getSnapshot();
  check('选区循环结束：回到选区起点', approx(snap.position, 2));
  check('选区循环结束：选区保留', !!snap.selection);
  check('选区循环结束：继续播放', snap.isPlaying);
  h.advance(1);
  check('循环后继续推进', approx(h.state.getSnapshot().position, 3));

  const g = harness(10);
  g.state.toggleLoop();
  g.state.play();
  g.advance(10);
  g.state.handleEnded();
  check('整曲循环结束：回到 0 继续', approx(g.state.getSnapshot().position, 0) && g.state.getSnapshot().isPlaying);
}

// 8. 切换循环：不影响位置、选区、播放状态
{
  const h = harness(10);
  h.state.setSelection({ start: 2, end: 4 });
  h.state.seek(3);
  h.state.play();
  h.advance(0.5);
  const before = h.state.getSnapshot();
  h.state.toggleLoop();
  let after = h.state.getSnapshot();
  check('开启循环不改变位置', approx(after.position, before.position));
  check('开启循环不改变选区', !!after.selection && after.selection.start === 2 && after.selection.end === 4);
  check('开启循环不改变播放状态', after.isPlaying === before.isPlaying);
  h.state.toggleLoop();
  after = h.state.getSnapshot();
  check('关闭循环后状态还原', !after.isLooping);
}

// 9. 重新加载文件：时间/选区/播放全部复位，不残留旧选区
{
  const h = harness(10);
  h.state.setSelection({ start: 2, end: 4 });
  h.state.toggleLoop();
  h.state.play();
  h.advance(1);
  h.state.load(20);
  const snap = h.state.getSnapshot();
  check('重新加载：位置归零', approx(snap.position, 0));
  check('重新加载：旧选区清空', snap.selection === null);
  check('重新加载：停止播放', !snap.isPlaying);
  check('重新加载：时长更新', approx(snap.duration, 20));
  check('重新加载：循环偏好保留', snap.isLooping);
}

// 10. 选区规范化
{
  const h = harness(10);
  h.state.setSelection({ start: 4, end: 2 });
  check('倒置选区被丢弃', h.state.getSnapshot().selection === null);
  h.state.setSelection({ start: 5, end: 5 });
  check('零宽选区被丢弃', h.state.getSnapshot().selection === null);
  h.state.setSelection({ start: -3, end: 99 });
  const sel = h.state.getSnapshot().selection;
  check('越界选区被裁剪', !!sel && approx(sel.start, 0) && approx(sel.end, 10));
}

// 11. 暂停在终点再播放：从范围起点重新开始
{
  const h = harness(10);
  h.state.setSelection({ start: 2, end: 4 });
  h.state.seek(4);
  h.state.play();
  check('在选区末端按播放：从选区起点重新开始', approx(h.state.getSnapshot().position, 2));
  h.state.setSelection(null);
  h.state.stop();
  h.state.seek(10);
  h.state.play();
  check('整曲末端按播放：从 0 重新开始', approx(h.state.getSnapshot().position, 0));
}

// 12. 订阅快照与查询状态一致
{
  const h = harness(10);
  h.state.setSelection({ start: 1, end: 3 });
  h.state.seek(2);
  h.state.play();
  const emitted = h.emitted();
  check('每次变更都推送快照', !!emitted && emitted.isPlaying);
  check('推送快照与查询一致',
    approx(emitted.position, h.state.getSnapshot().position) &&
    emitted.selection!.start === 1 && emitted.selection!.end === 3);

  let extraCalls = 0;
  const unsub = h.state.subscribe(() => {
    extraCalls++;
  });
  check('订阅时立即收到当前快照', extraCalls === 1);
  unsub();
  h.state.pause();
  check('退订后不再收到推送', extraCalls === 1);
}

// 13. 确定性随机连续操作：任意序列下不变量始终成立
{
  function mulberry32(seed: number): () => number {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rand = mulberry32(20261004);
  let now = 0;
  const state = new PlaybackState(() => now);
  state.load(10);
  let sequenceOk = true;
  const operations = ['play', 'pause', 'stop', 'seek', 'select', 'selectNull', 'loop', 'advance', 'load'] as const;

  for (let i = 0; i < 2000; i++) {
    const op = operations[Math.floor(rand() * operations.length)];
    switch (op) {
      case 'play': state.play(); break;
      case 'pause': state.pause(); break;
      case 'stop': state.stop(); break;
      case 'seek': state.seek(rand() * 12 - 1); break;
      case 'select': {
        const a = rand() * 10;
        const b = rand() * 10;
        const sel: Selection = { start: Math.min(a, b), end: Math.max(a, b) };
        state.setSelection(sel);
        break;
      }
      case 'selectNull': state.setSelection(null); break;
      case 'loop': state.toggleLoop(); break;
      case 'advance': now += rand() * 3; break;
      case 'load': state.load(Math.floor(rand() * 15) + 1); break;
    }
    if (!assertInvariants(state.getSnapshot())) {
      sequenceOk = false;
      console.error(`  invariant broken at step ${i}, op=${op}`, state.getSnapshot());
      break;
    }
  }
  check('2000 次随机连续操作：不变量始终成立', sequenceOk);
}

console.log(`PlaybackState: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
