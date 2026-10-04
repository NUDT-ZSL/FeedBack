import assert from 'node:assert/strict'
import {
  SIXTEENTH_NOTE_BEATS,
  NOTE_LIGHT_DURATION_MS,
  quantizeBeat,
  quantizeRecordedBeat,
  findNoteInSlot,
  beatToMs,
  buildPlaybackSchedule,
  PlaybackCursor,
  HighlightTracker,
} from '../src/sequencing.ts'

interface SimNote {
  id: string
  pitchIndex: number
  beatPosition: number
  timestamp: number
}

interface Click {
  offsetMs: number
  pitchIndex: number
}

const simulateRecording = (clicks: Click[], bpm: number) => {
  const notes: SimNote[] = []
  let dedupeSkips = 0
  clicks.forEach((click, index) => {
    const beatPosition = quantizeRecordedBeat(click.offsetMs, bpm)
    const existing = findNoteInSlot(notes, click.pitchIndex, beatPosition)
    if (existing) {
      dedupeSkips += 1
      return
    }
    notes.push({
      id: `note-${index}`,
      pitchIndex: click.pitchIndex,
      beatPosition,
      timestamp: click.offsetMs,
    })
  })
  return { notes, dedupeSkips }
}

const simulatePlayback = (notes: SimNote[], bpm: number, frameMs = 16) => {
  const cursor = new PlaybackCursor(buildPlaybackSchedule(notes, bpm))
  const fired: { noteId: string; pitchIndex: number; beatPosition: number; elapsedMs: number }[] = []
  let elapsed = 0
  while (!cursor.done || elapsed < cursor.endMs) {
    const due = cursor.advance(elapsed)
    due.forEach(event =>
      fired.push({
        noteId: event.noteId,
        pitchIndex: event.pitchIndex,
        beatPosition: event.beatPosition,
        elapsedMs: elapsed,
      })
    )
    if (cursor.done) break
    elapsed += frameMs
  }
  return fired
}

let passed = 0
const check = (name: string, fn: () => void) => {
  try {
    fn()
    passed += 1
    console.log(`  \u2713 ${name}`)
  } catch (error) {
    console.error(`  \u2717 ${name}`)
    console.error(`    ${(error as Error).message}`)
    process.exitCode = 1
  }
}

console.log('量化落点:')
check('任意小数拍位收敛到最近的十六分音符网格', () => {
  const cases: Array<[number, number]> = [
    [0.03, 0],
    [0.1, 0],
    [0.13, 0.25],
    [0.51, 0.5],
    [1.38, 1.5],
    [2.24, 2.25],
  ]
  for (const [raw, expected] of cases) {
    assert.equal(
      quantizeBeat(raw),
      expected,
      `quantizeBeat(${raw}) = ${quantizeBeat(raw)}, 期望 ${expected}`
    )
  }
})

check('录制时间换算的拍位全部落在 0.25 网格上', () => {
  const clicks: Click[] = [0, 97, 263, 508, 779, 1024, 1487, 2130].map(
    (offsetMs, index) => ({ offsetMs, pitchIndex: index % 8 })
  )
  const { notes } = simulateRecording(clicks, 120)
  assert.equal(notes.length, clicks.length)
  for (const note of notes) {
    const gridUnits = note.beatPosition / SIXTEENTH_NOTE_BEATS
    assert.ok(
      Math.abs(gridUnits - Math.round(gridUnits)) < 1e-9,
      `拍位 ${note.beatPosition} 不在十六分音符网格上`
    )
    const expected = quantizeRecordedBeat(note.timestamp, 120)
    assert.equal(note.beatPosition, expected)
  }
})

check('同一段演奏重复录制得到完全一致的拍位', () => {
  const clicks: Click[] = [12, 140, 390, 611, 888, 1255].map((offsetMs, i) => ({
    offsetMs,
    pitchIndex: (i * 3) % 8,
  }))
  const first = simulateRecording(clicks, 137).notes.map(n => n.beatPosition)
  const second = simulateRecording(clicks, 137).notes.map(n => n.beatPosition)
  assert.deepEqual(first, second)
})

console.log('同拍同音去重:')
check('同一拍位同一音高重复录入只保留一条并计数', () => {
  const clicks: Click[] = [
    { offsetMs: 110, pitchIndex: 2 },
    { offsetMs: 140, pitchIndex: 2 },
    { offsetMs: 125, pitchIndex: 2 },
  ]
  const { notes, dedupeSkips } = simulateRecording(clicks, 120)
  assert.equal(notes.length, 1)
  assert.equal(notes[0].beatPosition, 0.25)
  assert.equal(dedupeSkips, 2)
  assert.equal(findNoteInSlot(notes, 2, 0.25)?.id, notes[0].id)
})

check('同拍不同音高不去重,同音不同拍不去重', () => {
  const clicks: Click[] = [
    { offsetMs: 120, pitchIndex: 2 },
    { offsetMs: 130, pitchIndex: 5 },
    { offsetMs: 400, pitchIndex: 2 },
  ]
  const { notes, dedupeSkips } = simulateRecording(clicks, 120)
  assert.equal(notes.length, 3)
  assert.equal(dedupeSkips, 0)
})

console.log('录制 -> 回放对应:')
check('每个录制音符在回放中按自身实际拍位恰好触发一次', () => {
  const clicks: Click[] = [
    { offsetMs: 5, pitchIndex: 0 },
    { offsetMs: 130, pitchIndex: 3 },
    { offsetMs: 255, pitchIndex: 7 },
    { offsetMs: 380, pitchIndex: 1 },
    { offsetMs: 620, pitchIndex: 4 },
  ]
  const { notes } = simulateRecording(clicks, 120)
  const fired = simulatePlayback(notes, 120)

  assert.equal(fired.length, notes.length)
  const byId = new Map(fired.map(event => [event.noteId, event]))
  for (const note of notes) {
    const event = byId.get(note.id)
    assert.ok(event, `音符 ${note.id} 未触发`)
    assert.equal(event!.pitchIndex, note.pitchIndex)
    assert.equal(event!.beatPosition, note.beatPosition)
    const expectedMs = beatToMs(note.beatPosition, 120)
    assert.ok(
      event!.elapsedMs >= expectedMs,
      `音符提前触发: ${event!.elapsedMs} < ${expectedMs}`
    )
    assert.ok(
      event!.elapsedMs - expectedMs < 16,
      `音符触发延迟超过一帧: ${event!.elapsedMs - expectedMs}ms`
    )
  }

  const beats = fired.map(event => event.beatPosition)
  assert.deepEqual(beats, [...beats].sort((a, b) => a - b))
})

check('落在整拍之间的音符(含十六分细分)同样会触发高亮/发声', () => {
  const fractionalNotes: SimNote[] = [0.25, 0.75, 1.25, 2.75].map(
    (beatPosition, index) => ({
      id: `frac-${index}`,
      pitchIndex: index,
      beatPosition,
      timestamp: beatToMs(beatPosition, 120),
    })
  )
  const fired = simulatePlayback(fractionalNotes, 120)
  assert.deepEqual(
    fired.map(event => event.beatPosition),
    [0.25, 0.75, 1.25, 2.75]
  )
})

check('回放触发时间随 BPM 缩放', () => {
  const notes: SimNote[] = [
    { id: 'a', pitchIndex: 0, beatPosition: 1, timestamp: 0 },
    { id: 'b', pitchIndex: 1, beatPosition: 2, timestamp: 0 },
  ]
  const at120 = buildPlaybackSchedule(notes, 120).map(event => event.timeMs)
  const at60 = buildPlaybackSchedule(notes, 60).map(event => event.timeMs)
  assert.deepEqual(at120, [500, 1000])
  assert.deepEqual(at60, [1000, 2000])
})

console.log('连续同音高亮:')
check('同一音高连续触发各自独立,后一次不会提前熄灭前一次', () => {
  const tracker = new HighlightTracker()
  const duration = NOTE_LIGHT_DURATION_MS

  tracker.fire('same-note', 0)
  tracker.fire('same-note', 150)

  assert.deepEqual([...tracker.activeNoteIds(100)], ['same-note'])
  assert.deepEqual(
    [...tracker.activeNoteIds(205)],
    ['same-note'],
    '第一次触发已到期但第二次仍应保持高亮'
  )
  assert.deepEqual(
    [...tracker.activeNoteIds(150 + duration - 1)],
    ['same-note']
  )
  assert.deepEqual([...tracker.activeNoteIds(150 + duration + 1)], [])
})

check('回放中两个紧邻同音音符在整个时间窗内均能观察到连续高亮', () => {
  const notes: SimNote[] = [
    { id: 'repeat', pitchIndex: 3, beatPosition: 1, timestamp: 0 },
    { id: 'repeat', pitchIndex: 3, beatPosition: 1.25, timestamp: 0 },
  ]
  const schedule = buildPlaybackSchedule(notes, 120)
  const cursor = new PlaybackCursor(schedule)
  const tracker = new HighlightTracker()
  const firstTriggerMs = beatToMs(1, 120)
  const lastExpiryMs = beatToMs(1.25, 120) + NOTE_LIGHT_DURATION_MS
  const darkSamples: number[] = []

  for (let elapsed = 0; elapsed <= lastExpiryMs + 50; elapsed += 10) {
    cursor.advance(elapsed).forEach(event => tracker.fire(event.noteId, elapsed))
    if (elapsed >= firstTriggerMs && elapsed < lastExpiryMs) {
      if (!tracker.activeNoteIds(elapsed).has('repeat')) {
        darkSamples.push(elapsed)
      }
    }
  }
  assert.deepEqual(darkSamples, [], `两次触发之间在 ${darkSamples.join(', ')}ms 出现高亮空档`)
  assert.deepEqual([...tracker.activeNoteIds(lastExpiryMs + 40)], [])
})

check('clear 后不再有任何残留高亮', () => {
  const tracker = new HighlightTracker()
  tracker.fire('x', 0)
  tracker.clear()
  assert.deepEqual([...tracker.activeNoteIds(10)], [])
})

if (process.exitCode === 1) {
  console.error('\n存在失败用例')
} else {
  console.log(`\n全部 ${passed} 项检查通过`)
}
