import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyEffect,
  beginJump,
  beginRedo,
  beginUndo,
  completeJump,
  createInitialState,
  deriveAtIndex,
  loadAudio,
  normalizeSelection,
  redo,
  setInPoint,
  setOutPoint,
  undo,
  type EditorState,
  type EffectParams,
  type EffectType,
} from '../src/lib/editorEngine.ts'
import { renderEffectChain } from '../src/lib/audioEffects.ts'

const DURATION = 10
const FADE_IN: EffectParams = { fadeIn: { start: 0, end: 1, duration: 2 } }
const ECHO: EffectParams = { echo: { delay: 0.3, decay: 0.5 } }
const SPEED: EffectParams = { speed: { rate: 1.5 } }

let clock = 1000
function freshState(): EditorState {
  clock = 1000
  return loadAudio(createInitialState(), DURATION, clock)
}

function apply(state: EditorState, effect: EffectType, params: EffectParams): EditorState {
  clock += 1
  return applyEffect(state, effect, params, clock)
}

function effectSequence(state: EditorState) {
  return deriveAtIndex(state.history, state.historyIndex).effects.map((e) => e.effect)
}

test('快速连续点击同一效果：只产生一条历史记录，撤销一次即回到基线', () => {
  let state = freshState()
  state = setInPoint(state, 2)
  state = setOutPoint(state, 5)

  // 模拟快速连续点击 3 次相同效果按钮
  state = apply(state, 'fadeIn', FADE_IN)
  state = apply(state, 'fadeIn', FADE_IN)
  state = apply(state, 'fadeIn', FADE_IN)

  assert.equal(state.history.length, 2, '重复点击不应追加相同记录')
  assert.equal(state.historyIndex, 1)
  assert.deepEqual(effectSequence(state), ['fadeIn'])

  state = undo(state)
  assert.equal(state.historyIndex, 0, '撤销一次即回到基线，不存在无变化的中间记录')
  assert.deepEqual(effectSequence(state), [])
  assert.deepEqual(state.selection, { inPoint: 0, outPoint: DURATION })
})

test('参数或选区不同的连续点击仍应各自记录', () => {
  let state = freshState()
  state = apply(state, 'fadeIn', FADE_IN)
  state = apply(state, 'echo', ECHO)
  state = apply(state, 'speed', SPEED)
  assert.equal(state.history.length, 4)
  assert.deepEqual(effectSequence(state), ['fadeIn', 'echo', 'speed'])
})

test('反向选区拖拽被夹住，且不产生额外历史记录', () => {
  let state = freshState()
  state = setInPoint(state, 3)
  state = setOutPoint(state, 7)
  const historyBefore = state.history

  // 入点拖到出点右侧：被夹在出点处
  state = setInPoint(state, 9)
  assert.equal(state.selection.inPoint, 7)
  assert.equal(state.selection.outPoint, 7)

  // 出点拖到入点左侧：被夹在入点处
  state = setOutPoint(state, 2)
  assert.equal(state.selection.outPoint, 7)
  assert.equal(state.selection.inPoint, 7)

  // 越出音频边界同样被夹住
  state = setInPoint(state, -5)
  assert.equal(state.selection.inPoint, 0)
  state = setOutPoint(state, 99)
  assert.equal(state.selection.outPoint, DURATION)

  assert.ok(state.selection.inPoint <= state.selection.outPoint)
  assert.equal(state.history, historyBefore, '选区纠正不得产生历史记录')
  assert.equal(state.historyIndex, 0)
})

test('normalizeSelection 纠正任意反向区间', () => {
  const normalized = normalizeSelection({ inPoint: 8, outPoint: 2 }, DURATION)
  assert.deepEqual(normalized, { inPoint: 2, outPoint: 8 })
  const clamped = normalizeSelection({ inPoint: -3, outPoint: 99 }, DURATION)
  assert.deepEqual(clamped, { inPoint: 0, outPoint: DURATION })
})

test('撤销后应用新效果：被撤销的分支被截断，索引与效果序列同步', () => {
  let state = freshState()
  state = apply(state, 'fadeIn', FADE_IN)
  state = apply(state, 'echo', ECHO)
  state = apply(state, 'speed', SPEED)
  assert.equal(state.history.length, 4)

  state = undo(state)
  state = undo(state)
  assert.equal(state.historyIndex, 1)
  assert.deepEqual(effectSequence(state), ['fadeIn'])

  // 在撤销位置上应用新效果：echo/speed 分支被截断
  state = apply(state, 'reverse', { reverse: {} })
  assert.equal(state.history.length, 3, '被撤销的后续记录应被截断')
  assert.equal(state.historyIndex, 2)
  assert.deepEqual(effectSequence(state), ['fadeIn', 'reverse'])

  // 被截断的记录不可再通过 redo 到达
  state = redo(state)
  assert.equal(state.historyIndex, 2)
  assert.deepEqual(effectSequence(state), ['fadeIn', 'reverse'])
})

test('跳转进行中：再次操作被忽略，完成后索引/选区/效果链一致', () => {
  let state = freshState()
  state = setInPoint(state, 1)
  state = setOutPoint(state, 4)
  state = apply(state, 'fadeIn', FADE_IN)
  state = setInPoint(state, 2)
  state = setOutPoint(state, 8)
  state = apply(state, 'echo', ECHO)
  assert.equal(state.historyIndex, 2)

  // 开始跳转到基线
  state = beginJump(state, 0)
  assert.equal(state.jumpInProgress, true)
  assert.equal(state.historyIndex, 2, '跳转完成前索引不变')

  // 跳转中的一切操作都被忽略
  const snapshot = state
  state = apply(state, 'speed', SPEED)
  assert.equal(state, snapshot, '跳转中应用效果应被忽略')
  state = undo(state)
  assert.equal(state, snapshot, '跳转中撤销应被忽略')
  state = beginJump(state, 1)
  assert.equal(state, snapshot, '跳转中再次跳响应被忽略')
  state = beginUndo(state)
  assert.equal(state, snapshot)
  state = beginRedo(state)
  assert.equal(state, snapshot)
  state = setInPoint(state, 5)
  assert.equal(state, snapshot, '跳转中拖拽选区应被忽略')

  // 完成跳转：索引、选区、效果链回到目标记录对应状态
  state = completeJump(state)
  assert.equal(state.jumpInProgress, false)
  assert.equal(state.historyIndex, 0)
  assert.deepEqual(state.selection, { inPoint: 0, outPoint: DURATION })
  assert.deepEqual(effectSequence(state), [])

  // 跳转到中间记录：选区恢复为该记录应用时的区间
  state = beginJump(state, 1)
  state = completeJump(state)
  assert.equal(state.historyIndex, 1)
  assert.deepEqual(state.selection, { inPoint: 1, outPoint: 4 })
  assert.deepEqual(effectSequence(state), ['fadeIn'])
})

test('任意操作顺序下，效果链始终等于历史序列前缀的重放', () => {
  let state = freshState()
  state = apply(state, 'fadeIn', FADE_IN)
  state = apply(state, 'echo', ECHO)
  state = apply(state, 'reverse', { reverse: {} })

  const expectConsistent = (s: EditorState) => {
    const derived = deriveAtIndex(s.history, s.historyIndex)
    assert.deepEqual(s.selection, derived.selection, '选区必须由序列推导')
    const expected = s.history
      .slice(1, s.historyIndex + 1)
      .filter((e) => e.kind === 'effect')
      .map((e) => e.effect)
    assert.deepEqual(derived.effects.map((e) => e.effect), expected)
  }

  state = undo(state)
  expectConsistent(state)
  state = redo(state)
  expectConsistent(state)
  state = beginJump(state, 0)
  state = completeJump(state)
  expectConsistent(state)
  state = beginJump(state, 3)
  state = completeJump(state)
  expectConsistent(state)
  state = undo(state)
  state = undo(state)
  expectConsistent(state)
  state = apply(state, 'speed', SPEED)
  expectConsistent(state)
  assert.deepEqual(effectSequence(state), ['fadeIn', 'speed'])
})

test('效果链可复现：同一序列重放结果确定，reverse 两次还原', () => {
  const sampleRate = 100
  const original = Float32Array.from({ length: 1000 }, () => Math.random() * 2 - 1)
  const range = { inPoint: 2, outPoint: 6 }

  const chain = [
    { effect: 'reverse' as const, params: {}, range },
    { effect: 'reverse' as const, params: {}, range },
  ]
  const once = renderEffectChain(original, sampleRate, chain)
  const twice = renderEffectChain(original, sampleRate, chain)
  assert.deepEqual(once, twice, '同一序列重放结果必须确定')
  assert.deepEqual(once, original, '翻转两次应还原原始音频')

  const faded = renderEffectChain(original, sampleRate, [
    { effect: 'fadeIn', params: FADE_IN, range },
  ])
  assert.equal(faded.length, original.length)
  assert.ok(Math.abs(faded[200]) < 1e-6, '淡入起点增益应接近 0')
  assert.equal(faded[100], original[100], '选区外不受影响')

  const sped = renderEffectChain(original, sampleRate, [
    { effect: 'speed', params: SPEED, range },
  ])
  const expectedRegion = Math.round(400 / 1.5)
  assert.equal(sped.length, 1000 - 400 + expectedRegion, '变速应改变选区长度')
})
