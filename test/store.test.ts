import { AppStore, type StateKey } from '../src/app-store';
import { GestureActions } from '../src/gesture-actions';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { failures++; console.error('FAIL:', msg); }
  else console.log('ok:', msg);
}
const approx = (a: number, b: number) => Math.abs(a - b) < 1e-9;

function makeMockAudio() {
  const calls: string[] = [];
  return {
    calls,
    loadSong: (s: { title: string }) => { calls.push('loadSong:' + s.title); },
    play: () => { calls.push('play'); },
    pause: () => { calls.push('pause'); },
    setVolume: (v: number) => { calls.push('setVolume:' + v.toFixed(3)); },
    seek: (t: number) => { calls.push('seek:' + t.toFixed(1)); }
  };
}

// 1. 同一帧内同一手势连续触发多次 -> 只产生一次状态变更
{
  const audio = makeMockAudio();
  const store = new AppStore(audio as never);
  const ga = new GestureActions(store);
  ga.enqueue('1-finger');
  ga.enqueue('1-finger');
  ga.enqueue('1-finger');
  ga.flush(1000);
  assert(audio.calls.filter(c => c === 'play').length === 1, 'frame coalescing: togglePlay once');
  assert(store.getState().isPlaying === true, 'isPlaying toggled once -> true');
}

// 2. 手势保持期间（多帧重复上报）不会重复触发；释放后再次做出才重新触发
{
  const audio = makeMockAudio();
  const store = new AppStore(audio as never);
  const ga = new GestureActions(store);
  ga.enqueue('1-finger'); ga.flush(1000);
  ga.enqueue('1-finger'); ga.flush(1016);
  ga.enqueue('1-finger'); ga.flush(1033);
  assert(audio.calls.filter(c => c === 'play').length === 1, 'held gesture: no repeat while latched');
  ga.enqueue('none'); ga.flush(1050);
  ga.enqueue('1-finger'); ga.flush(1066);
  assert(audio.calls.filter(c => c === 'pause').length === 1, 're-show after release toggles again');
  assert(store.getState().isPlaying === false, 'isPlaying back to false');
}

// 3. 音量手势：进入时立即步进一次，之后按 180ms 节奏步进，释放即停止
{
  const audio = makeMockAudio();
  const store = new AppStore(audio as never);
  const ga = new GestureActions(store);
  ga.enqueue('3-finger'); ga.flush(10000);
  assert(approx(store.getState().volume, 0.74), 'volume gesture: immediate +0.04');
  ga.tick(100100 - 10000 * 9); // 10010ms, < 180ms
  assert(approx(store.getState().volume, 0.74), 'no step before interval');
  ga.tick(10181);
  assert(approx(store.getState().volume, 0.775), 'step +0.035 after 180ms');
  ga.tick(10361);
  assert(approx(store.getState().volume, 0.81), 'second continuous step');
  ga.enqueue('none'); ga.flush(10400);
  ga.tick(10600);
  assert(approx(store.getState().volume, 0.81), 'stops after release');
}

// 4. 静音 / 恢复：0.7 -> 0 -> 0.7
{
  const audio = makeMockAudio();
  const store = new AppStore(audio as never);
  store.toggleMute();
  assert(approx(store.getState().volume, 0), 'mute -> 0');
  store.toggleMute();
  assert(approx(store.getState().volume, 0.7), 'unmute -> 0.7');
}

// 5. 主题切换：一次 commit 一次通知；重复设置同主题不通知
{
  const audio = makeMockAudio();
  const store = new AppStore(audio as never);
  const events: ReadonlySet<StateKey>[] = [];
  store.subscribe((_s, changed) => events.push(changed), false);
  store.setTheme(1);
  store.setTheme(1);
  store.setTheme(2);
  assert(events.length === 2, 'theme: exactly one notification per change');
  assert(events[0].has('themeIndex') && events[0].size === 1, 'theme commit carries themeIndex only');
  assert(store.getState().themeIndex === 2, 'themeIndex updated');
}

// 6. 切歌：索引环绕、自动播放、结束自动切歌
{
  const audio = makeMockAudio();
  const store = new AppStore(audio as never);
  store.loadSong(0, false);
  assert(store.getState().isPlaying === false, 'loadSong without autoplay stays paused');
  store.nextSong();
  assert(store.getState().songIndex === 1 && store.getState().isPlaying, 'nextSong -> index 1, playing');
  store.loadSong(4, true);
  store.nextSong();
  assert(store.getState().songIndex === 0, 'playlist wraps around');
  store.onSongEnded();
  assert(store.getState().songIndex === 1 && store.getState().isPlaying, 'ended -> auto next song');
  assert(audio.calls.filter(c => c.startsWith('loadSong')).length === 5, 'engine loadSong per action');
}

// 7. 键盘路径与手势路径走同一 action：音量加减一致
{
  const audio = makeMockAudio();
  const store = new AppStore(audio as never);
  store.adjustVolume(0.05);
  store.adjustVolume(-0.05);
  assert(approx(store.getState().volume, 0.7), 'keyboard volume delta round-trip');
  store.adjustVolume(-2);
  assert(approx(store.getState().volume, 0), 'volume clamped at 0');
  store.adjustVolume(2);
  assert(approx(store.getState().volume, 1), 'volume clamped at 1');
}

// 8. 订阅即收到当前状态（初始渲染同步）
{
  const audio = makeMockAudio();
  const store = new AppStore(audio as never);
  let got = -1;
  store.subscribe((s) => { got = s.songIndex; });
  assert(got === 0, 'subscribe emits current state immediately');
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nall assertions passed');
