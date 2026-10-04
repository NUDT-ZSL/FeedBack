// 离线验证：录制量化、同位去重、回放调度与独立高亮的一致性。
// 运行：npm run verify（无需网络与浏览器）
import {
  SUBDIVISIONS_PER_BEAT,
  quantizeBeat,
  beatToMs,
  msToBeat,
  recordBeatPosition,
  findNoteAt,
  buildPlaybackSchedule,
  applyLightUp,
  applyLightDown,
  isNoteLit,
} from '../src/melodyUtils.ts'

const NOTE_LIGHT_DURATION = 200
let failures = 0

const check = (name, cond, detail = '') => {
  if (cond) {
    console.log(`  ok  ${name}`)
  } else {
    failures++
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// 确定性伪随机数，保证离线可重复
const mulberry32 = seed => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// 模拟组件 addNote 的录制分支：量化 + 同拍位同音高去重
const makeRecorder = bpm => {
  const notes = []
  const lightUps = []
  return {
    notes,
    lightUps,
    press(pitchIndex, elapsedMs) {
      const beatPosition = recordBeatPosition(elapsedMs, bpm)
      const existing = findNoteAt(notes, pitchIndex, beatPosition)
      if (existing) {
        lightUps.push(existing.id)
        return existing
      }
      const note = {
        id: `note-${notes.length}`,
        pitchIndex,
        beatPosition,
        timestamp: beatToMs(beatPosition, bpm),
      }
      notes.push(note)
      lightUps.push(note.id)
      return note
    },
  }
}

console.log('1. 录制落点量化到十六分音符网格')
{
  const bpm = 120
  const rand = mulberry32(42)
  const rec = makeRecorder(bpm)
  for (let i = 0; i < 200; i++) {
    rec.press(Math.floor(rand() * 8), rand() * 8000)
  }
  const onGrid = rec.notes.every(
    n => Math.abs(n.beatPosition * SUBDIVISIONS_PER_BEAT - Math.round(n.beatPosition * SUBDIVISIONS_PER_BEAT)) < 1e-9
  )
  check('所有拍位均为 0.25 的整数倍', onGrid)
  check('timestamp 与量化拍位一致', rec.notes.every(n => Math.abs(msToBeat(n.timestamp, bpm) - n.beatPosition) < 1e-9))
}

console.log('2. 同一段演奏重复录制结果一致')
{
  const bpm = 140
  const slotMs = beatToMs(0.25, bpm)
  const idealPresses = Array.from({ length: 32 }, (_, i) => ({
    pitch: (i * 3) % 8,
    ms: (i * 2 + 1) * slotMs,
  }))
  const run = seed => {
    const rand = mulberry32(seed)
    const rec = makeRecorder(bpm)
    idealPresses.forEach(p => rec.press(p.pitch, p.ms + (rand() - 0.5) * 60))
    return rec.notes.map(n => `${n.pitchIndex}@${n.beatPosition}`).join(',')
  }
  check('两次带抖动录制产生相同量化序列', run(1) === run(2))
}

console.log('3. 同拍位同音高去重且结果可观察')
{
  const bpm = 120
  const rec = makeRecorder(bpm)
  const sixteenthMs = beatToMs(0.25, bpm)
  const first = rec.press(3, 500)
  const dup = rec.press(3, 500 + sixteenthMs * 0.4)
  const otherPitch = rec.press(4, 500 + sixteenthMs * 0.4)
  const otherBeat = rec.press(3, 500 + sixteenthMs)
  check('重复击打合并为一条', rec.notes.filter(n => n.pitchIndex === 3 && n.beatPosition === first.beatPosition).length === 1)
  check('重复击打返回已存在的音符', dup.id === first.id)
  check('重复击打仍点亮已存在音符', rec.lightUps[1] === first.id)
  check('不同音高不去重', otherPitch.id !== first.id)
  check('不同拍位不去重', otherBeat.beatPosition === first.beatPosition + 0.25)
}

console.log('4. 回放按每个音符的实际拍位调度')
{
  const bpm = 100
  const notes = [
    { id: 'a', pitchIndex: 0, beatPosition: 2.5 },
    { id: 'b', pitchIndex: 5, beatPosition: 0.75 },
    { id: 'c', pitchIndex: 0, beatPosition: 0.75 },
    { id: 'd', pitchIndex: 3, beatPosition: 4 },
  ]
  const schedule = buildPlaybackSchedule(notes, bpm)
  check('事件按拍位升序', schedule.every((e, i) => i === 0 || schedule[i - 1].timeMs <= e.timeMs))
  check('每个音符恰好一个事件', schedule.length === notes.length && new Set(schedule.map(e => e.note.id)).size === notes.length)
  check(
    '触发时间等于拍位换算时间',
    schedule.every(e => Math.abs(e.timeMs - beatToMs(e.note.beatPosition, bpm)) < 1e-9)
  )
  check(
    '拍间音符（0.75）不被吞掉',
    schedule.filter(e => e.note.beatPosition === 0.75).length === 2
  )
  check(
    '调度结果可逆映射回网格拍位',
    schedule.every(e => Math.abs(msToBeat(e.timeMs, bpm) - e.note.beatPosition) < 1e-9)
  )
}

console.log('5. 同一音符连续触发时高亮各自独立')
{
  let counts = new Map()
  let now = 0
  const timers = []
  const lightUp = id => {
    counts = applyLightUp(counts, id)
    const due = now + NOTE_LIGHT_DURATION
    timers.push({ due, id })
    timers.sort((a, b) => a.due - b.due)
  }
  const advanceTo = t => {
    while (timers.length && timers[0].due <= t) {
      const timer = timers.shift()
      now = timer.due
      counts = applyLightDown(counts, timer.id)
    }
    now = t
  }
  lightUp('n1')
  advanceTo(100)
  lightUp('n1')
  advanceTo(250)
  check('第一次计时不覆盖第二次（t=250 仍亮）', isNoteLit(counts, 'n1'))
  advanceTo(301)
  check('两次高亮都结束后熄灭（t=301）', !isNoteLit(counts, 'n1'))
  lightUp('n1')
  advanceTo(350)
  lightUp('n2')
  advanceTo(549)
  check('不同音符互不影响（t=549 仅 n2 亮）', !isNoteLit(counts, 'n1') && isNoteLit(counts, 'n2'))
  advanceTo(551)
  check('n2 到时长后熄灭（t=551）', !isNoteLit(counts, 'n2'))
}

console.log('6. 录制到回放端到端对应')
{
  const bpm = 90
  const rand = mulberry32(7)
  const rec = makeRecorder(bpm)
  for (let i = 0; i < 60; i++) {
    rec.press(Math.floor(rand() * 8), 100 + i * 90 + rand() * 40)
  }
  const schedule = buildPlaybackSchedule(rec.notes, bpm)
  const byId = new Map(rec.notes.map(n => [n.id, n]))
  check(
    '每个录制音符在其量化拍位准时触发',
    schedule.every(e => {
      const n = byId.get(e.note.id)
      return n && Math.abs(e.timeMs - beatToMs(n.beatPosition, bpm)) < 1e-9
    })
  )
  check(
    '回放事件数与去重后音符数一致',
    schedule.length === rec.notes.length
  )
}

if (failures > 0) {
  console.error(`\n${failures} 项验证失败`)
  process.exit(1)
}
console.log('\n全部验证通过')
