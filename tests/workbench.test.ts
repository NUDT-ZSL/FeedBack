import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  createState,
  applyEffect,
  setSelection,
  requestUndo,
  requestRedo,
  jumpTo,
  completeJump,
  deriveEffects,
  deriveSelection,
  currentIndex,
  canUndo,
  canRedo,
  clampSelection,
  checkInvariant,
} from '../src/lib/workbench/engine'
import { renderAudio } from '../src/lib/workbench/audio'
import type { EffectParams, EffectType, WorkbenchState } from '../src/lib/workbench/types'

const DURATION = 10
const fadeIn = (duration = 2): EffectParams => ({ fadeIn: { start: 0, end: 1, duration } })
const fadeOut = (duration = 2): EffectParams => ({ fadeOut: { start: 1, end: 0, duration } })
const echo: EffectParams = { echo: { delay: 0.3, decay: 0.5 } }
const speed = (rate: number): EffectParams => ({ speed: { rate } })

const apply = (s: WorkbenchState, type: EffectType, params: EffectParams) =>
  applyEffect(s, type, params, { id: `fx_${s.records.length}_${type}`, timestamp: 1_000_000 + s.records.length })

const settled = (s: WorkbenchState) => {
  checkInvariant(s)
  return s
}

/** 应用/撤销/重做/跳转完成后：选区必须由记录序列重新推导 */
const expectDerived = (s: WorkbenchState) => {
  assert.equal(s.jumpStatus, 'idle')
  assert.deepEqual(s.selection, deriveSelection(s, s.appliedCount))
  return s
}

const undo = (s: WorkbenchState) => expectDerived(settled(completeJump(requestUndo(s))))
const redo = (s: WorkbenchState) => expectDerived(settled(completeJump(requestRedo(s))))
const jump = (s: WorkbenchState, i: number) => expectDerived(settled(completeJump(jumpTo(s, i))))

describe('快速连续点击同一效果按钮', () => {
  test('类型/参数/区间完全相同的连续点击只产生一条记录、音频只推进一格', () => {
    let s = createState(DURATION)
    s = expectDerived(apply(s, 'fadeIn', fadeIn()))
    const audioAfterOne = renderAudio(new Float32Array(100), 10, deriveEffects(s))
    s = apply(s, 'fadeIn', fadeIn())
    s = apply(s, 'fadeIn', fadeIn())
    s = expectDerived(settled(s))

    assert.equal(s.records.length, 1)
    assert.equal(s.appliedCount, 1)
    assert.equal(currentIndex(s), 0)

    const audioAfterClicks = renderAudio(new Float32Array(100), 10, deriveEffects(s))
    assert.deepEqual(Array.from(audioAfterOne), Array.from(audioAfterClicks))

    s = undo(s)
    assert.equal(s.appliedCount, 0)
    assert.equal(s.records.length, 1, '撤销保留记录以便重做')
    assert.deepEqual(s.selection, { in: 0, out: DURATION })
    assert.deepEqual(deriveEffects(s), [])
  })

  test('参数或区间不同的效果不会被合并', () => {
    let s = createState(DURATION)
    s = apply(s, 'fadeIn', fadeIn(2))
    s = apply(s, 'fadeIn', fadeIn(3))
    s = expectDerived(settled(s))
    assert.equal(s.records.length, 2)

    s = undo(s)
    s = settled(setSelection(s, { in: 2, out: 5 }))
    s = apply(s, 'fadeIn', fadeIn(3))
    s = expectDerived(settled(s))
    assert.equal(s.records.length, 2, '区间不同即视为新操作')
    assert.deepEqual(s.records[1].range, { in: 2, out: 5 })
  })

  test('相同效果被其他效果隔开后再次出现仍是独立记录', () => {
    let s = createState(DURATION)
    s = apply(s, 'reverse', {})
    s = apply(s, 'echo', echo)
    s = apply(s, 'reverse', {})
    s = expectDerived(settled(s))
    assert.deepEqual(s.records.map((r) => r.type), ['reverse', 'echo', 'reverse'])
  })
})

describe('反向选区拖拽', () => {
  test('入点拖过出点时夹住到出点，且不产生历史记录', () => {
    let s = createState(DURATION)
    s = apply(s, 'echo', echo)
    const recordsBefore = s.records.length

    s = settled(setSelection(s, { in: 8, out: 2 }))
    assert.equal(s.selection.in, 2)
    assert.equal(s.selection.out, 2)
    assert.equal(s.records.length, recordsBefore)
    assert.equal(s.appliedCount, 1)
  })

  test('出点拖过入点时夹住到入点', () => {
    let s = createState(DURATION)
    s = settled(setSelection(s, { in: 4 }))
    s = settled(setSelection(s, { out: 1 }))
    assert.equal(s.selection.in, 1)
    assert.equal(s.selection.out, 1)
  })

  test('超出时长/小于 0 的拖拽被夹住到边界', () => {
    let s = createState(DURATION)
    s = settled(setSelection(s, { in: -5, out: 99 }))
    assert.deepEqual(s.selection, { in: 0, out: DURATION })
    assert.equal(s.records.length, 0)
  })

  test('零宽选区上应用效果被忽略，不产生记录', () => {
    let s = createState(DURATION)
    s = settled(setSelection(s, { in: 5, out: 2 }))
    assert.deepEqual(s.selection, { in: 2, out: 2 })
    const after = apply(s, 'echo', echo)
    assert.equal(after.records.length, 0)
    assert.equal(after.appliedCount, 0)
  })

  test('clampSelection 直接性质', () => {
    assert.deepEqual(clampSelection({ in: 6, out: 3 }, 10), { in: 3, out: 3 })
    assert.deepEqual(clampSelection({ in: -1, out: 11 }, 10), { in: 0, out: 10 })
  })
})

describe('撤销后新增操作截断被撤销分支', () => {
  test('新效果发生时索引之后的记录被删除，无法再跳转回旧分支', () => {
    let s = createState(DURATION)
    s = apply(s, 'reverse', {})
    s = settled(setSelection(s, { in: 2, out: 4 }))
    s = apply(s, 'echo', echo)
    s = settled(setSelection(s, { in: 6, out: 8 }))
    s = apply(s, 'speed', speed(1.5))
    assert.deepEqual(s.records.map((r) => r.type), ['reverse', 'echo', 'speed'])

    s = jump(s, 0)
    assert.equal(s.appliedCount, 1)
    assert.deepEqual(s.selection, { in: 0, out: DURATION })
    assert.deepEqual(deriveEffects(s).map((r) => r.type), ['reverse'])

    s = apply(s, 'fadeIn', fadeIn())
    s = expectDerived(settled(s))
    assert.deepEqual(s.records.map((r) => r.type), ['reverse', 'fadeIn'])
    assert.equal(s.appliedCount, 2)
    assert.equal(currentIndex(s), 1)
    assert.deepEqual(s.selection, { in: 0, out: DURATION })
    assert.equal(canRedo(s), false)
  })

  test('撤销到根部后新增同样截断', () => {
    let s = createState(DURATION)
    s = apply(s, 'reverse', {})
    s = apply(s, 'echo', echo)
    s = undo(s)
    s = undo(s)
    assert.equal(s.appliedCount, 0)
    s = apply(s, 'speed', speed(2))
    s = expectDerived(settled(s))
    assert.deepEqual(s.records.map((r) => r.type), ['speed'])
  })
})

describe('跳转进行中再次操作', () => {
  test('跳转期间所有入口都被忽略，按钮状态不可用，完成后状态回到目标记录', () => {
    let s = createState(DURATION)
    s = apply(s, 'reverse', {})
    s = settled(setSelection(s, { in: 2, out: 4 }))
    s = apply(s, 'echo', echo)
    s = settled(setSelection(s, { in: 6, out: 8 }))
    s = apply(s, 'fadeOut', fadeOut())

    s = jumpTo(s, 0)
    assert.equal(s.jumpStatus, 'jumping')
    assert.equal(canUndo(s), false)
    assert.equal(canRedo(s), false)
    assert.equal(s.pendingCount, 1)

    const during = s
    assert.equal(applyEffect(during, 'echo', echo), during)
    assert.equal(jumpTo(during, 2), during)
    assert.equal(requestUndo(during), during)
    assert.equal(requestRedo(during), during)
    assert.equal(setSelection(during, { in: 1, out: 2 }), during)

    s = completeJump(s)
    assert.equal(s.jumpStatus, 'idle')
    assert.equal(s.appliedCount, 1)
    assert.equal(currentIndex(s), 0)
    assert.deepEqual(s.selection, { in: 0, out: DURATION })
    assert.deepEqual(deriveEffects(s).map((r) => r.type), ['reverse'])
  })

  test('无变化的跳转不会进入进行中状态', () => {
    let s = createState(DURATION)
    s = apply(s, 'echo', echo)
    const after = jumpTo(s, 0)
    assert.equal(after.jumpStatus, 'idle')
  })

  test('撤销/重做经过跳转状态推导，且可往返', () => {
    let s = createState(DURATION)
    s = apply(s, 'reverse', {})
    s = settled(setSelection(s, { in: 2, out: 4 }))
    s = apply(s, 'echo', echo)

    s = undo(s)
    assert.deepEqual(deriveEffects(s).map((r) => r.type), ['reverse'])
    assert.deepEqual(s.selection, { in: 0, out: DURATION })

    s = redo(s)
    assert.deepEqual(deriveEffects(s).map((r) => r.type), ['reverse', 'echo'])
    assert.deepEqual(s.selection, { in: 2, out: 4 })
  })
})

describe('音频状态从效果链重新推导', () => {
  test('渲染结果只取决于生效前缀，撤销/跳转后与当时音频一致', () => {
    const sampleRate = 100
    const original = new Float32Array(1000).map((_, i) => Math.sin(i / 23))
    let s = createState(10)
    s = apply(s, 'reverse', {})
    const audioAt1 = renderAudio(original, sampleRate, deriveEffects(s))
    s = apply(s, 'echo', echo)
    const audioAt2 = renderAudio(original, sampleRate, deriveEffects(s))
    assert.ok(!audioAt1.every((v, i) => v === audioAt2[i]))

    s = undo(s)
    assert.deepEqual(Array.from(renderAudio(original, sampleRate, deriveEffects(s))), Array.from(audioAt1))
    s = redo(s)
    assert.deepEqual(Array.from(renderAudio(original, sampleRate, deriveEffects(s))), Array.from(audioAt2))
    s = jump(s, 0)
    assert.deepEqual(Array.from(renderAudio(original, sampleRate, deriveEffects(s))), Array.from(audioAt1))
  })

  test('连续相同翻转被合并为一条；区间不同的两次翻转恢复原音频', () => {
    const sampleRate = 100
    const original = new Float32Array(1000).map((_, i) => (i % 7) - 3)
    let s = createState(10)
    s = apply(s, 'reverse', {})
    s = apply(s, 'reverse', {})
    s = settled(s)
    assert.equal(s.records.length, 1, '相同的连续翻转只推进一格')

    // 区间不同则是新记录：先翻转整段，再翻转子区间 [2,4)
    s = createState(10)
    s = apply(s, 'reverse', {})
    s = settled(setSelection(s, { in: 2, out: 4 }))
    s = apply(s, 'reverse', {})
    assert.equal(s.records.length, 2)
    const out = renderAudio(original, sampleRate, deriveEffects(s))
    // 整段翻转后子区间 [2,4) 对应原音频尾部的 [6,8)，再翻转回来
    const expected = original.slice().reverse()
    const sub = expected.slice(200, 400).reverse()
    expected.set(sub, 200)
    assert.deepEqual(Array.from(out), Array.from(expected))

    s = createState(10)
    s = apply(s, 'speed', speed(2))
    const spedUp = renderAudio(original, sampleRate, deriveEffects(s))
    assert.equal(spedUp.length, original.length, '变速保持时间轴长度不变')
    assert.ok(spedUp.some((v, i) => v !== original[i]), '变速确实改变了内容')

    // DSP 层：不同 rate 结果不同，rate=1 恒等
    const rateOne = renderAudio(original, sampleRate, [{
      id: 'r', timestamp: 0, type: 'speed', params: speed(1),
      range: { in: 0, out: 10 }, description: '变速 1x',
    }])
    assert.deepEqual(Array.from(rateOne), Array.from(original))
  })

  test('快速连点只让音频推进一格（与单次点击结果完全一致）', () => {
    const sampleRate = 100
    const original = new Float32Array(1000).map((_, i) => Math.cos(i / 17))
    const once = renderAudio(original, sampleRate, [{
      id: 'x', timestamp: 0, type: 'fadeIn', params: fadeIn(),
      range: { in: 0, out: 10 }, description: '淡入',
    }])
    let s = createState(10)
    for (let i = 0; i < 5; i++) s = apply(s, 'fadeIn', fadeIn())
    assert.deepEqual(Array.from(renderAudio(original, sampleRate, deriveEffects(s))), Array.from(once))
  })
})

describe('任意操作顺序下的一致性（伪随机 fuzz）', () => {
  test('1000 次随机操作后索引/选区/效果序列始终自洽', () => {
    let s = createState(DURATION)
    let seed = 42
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 2 ** 32
      return seed / 2 ** 32
    }
    const types: Array<[EffectType, EffectParams]> = [
      ['fadeIn', fadeIn(1 + Math.floor(rand() * 3))],
      ['fadeOut', fadeOut(1)],
      ['echo', echo],
      ['speed', speed(0.5 + rand() * 1.5)],
      ['reverse', {}],
    ]

    for (let step = 0; step < 1000; step++) {
      const op = Math.floor(rand() * 8)
      const before = s
      switch (op) {
        case 0:
        case 1: {
          const [type, params] = types[Math.floor(rand() * types.length)]
          s = applyEffect(s, type, structuredClone(params))
          break
        }
        case 2:
          s = setSelection(s, { in: rand() * 12 - 1 })
          break
        case 3:
          s = setSelection(s, { out: rand() * 12 - 1 })
          break
        case 4:
          s = requestUndo(s)
          break
        case 5:
          s = requestRedo(s)
          break
        case 6:
          s = jumpTo(s, Math.floor(rand() * (s.records.length + 1)) - 1)
          break
        default:
          s = completeJump(s)
      }
      checkInvariant(s)
      assert.deepEqual(deriveEffects(s), s.records.slice(0, s.appliedCount))
      if (s.jumpStatus === 'idle') {
        assert.equal(s.pendingCount, null)
        const derivingOp = op === 0 || op === 1 || op === 4 || op === 5 || op === 6 || op === 7
        if (derivingOp && s !== before) {
          assert.deepEqual(s.selection, deriveSelection(s, s.appliedCount))
        }
      }
    }
    s = completeJump(s)
    checkInvariant(s)
    assert.equal(s.appliedCount >= 0 && s.appliedCount <= s.records.length, true)
  })
})
