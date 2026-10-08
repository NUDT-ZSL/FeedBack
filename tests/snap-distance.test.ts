import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkSnapDistance,
  tryAssembleComponent,
  markAllProcessed,
  getComponents,
} from '../src/Assembly.ts'
import { resetAll, componentOf } from './helpers.ts'

beforeEach(resetAll)

test('正常路径：落点即目标位置，吸附成功', () => {
  assert.equal(checkSnapDistance([0, 0, 0], [0, 0, 0]), true)
})

test('阈值内：单轴小偏移吸附成功', () => {
  assert.equal(checkSnapDistance([0.4, 0, 0], [0, 0, 0], 0.5), true)
})

test('边界：距离恰好等于阈值判定为成功', () => {
  assert.equal(checkSnapDistance([0.5, 0, 0], [0, 0, 0], 0.5), true)
})

test('超出阈值：吸附失败', () => {
  assert.equal(checkSnapDistance([0.5 + 1e-9, 0, 0], [0, 0, 0], 0.5), false)
  assert.equal(checkSnapDistance([3, 4, 0], [0, 0, 0], 5 - 1e-9), false)
})

test('斜向合成距离按欧氏距离判定', () => {
  // 3-4-5：恰好 5，阈值 5 成功
  assert.equal(checkSnapDistance([3, 4, 0], [0, 0, 0], 5), true)
  assert.equal(checkSnapDistance([3, 4, 1], [0, 0, 0], 5), false)
})

test('负坐标偏移同样适用', () => {
  assert.equal(checkSnapDistance([-0.3, -0.2, 0.1], [0, 0, 0], 0.5), true)
  assert.equal(checkSnapDistance([-3, -4, 0], [0, 0, 0], 4.9), false)
})

test('自定义阈值生效（视口使用 1.5）', () => {
  assert.equal(checkSnapDistance([1.4, 0, 0], [0, 0, 0], 1.5), true)
  assert.equal(checkSnapDistance([1.6, 0, 0], [0, 0, 0], 1.5), false)
})

test('位置缺失：null / undefined 不误判为成功', () => {
  assert.equal(checkSnapDistance(null, [0, 0, 0]), false)
  assert.equal(checkSnapDistance(undefined, [0, 0, 0]), false)
  assert.equal(checkSnapDistance([0, 0, 0], null), false)
  assert.equal(checkSnapDistance(undefined, undefined), false)
})

test('数值异常：NaN / Infinity / 非数值 / 维度不全均失败', () => {
  assert.equal(checkSnapDistance([NaN, 0, 0], [0, 0, 0]), false)
  assert.equal(checkSnapDistance([Infinity, 0, 0], [0, 0, 0]), false)
  assert.equal(checkSnapDistance([-Infinity, 0, 0], [0, 0, 0]), false)
  assert.equal(checkSnapDistance([0, 0, 0], [0, NaN, 0]), false)
  assert.equal(
    checkSnapDistance([0, 0, 'x'] as unknown as [number, number, number], [0, 0, 0]),
    false
  )
  assert.equal(
    checkSnapDistance([0, 0] as unknown as [number, number, number], [0, 0, 0]),
    false
  )
  assert.equal(
    checkSnapDistance({} as unknown as [number, number, number], [0, 0, 0]),
    false
  )
})

test('阈值异常（NaN / 负数）时失败', () => {
  assert.equal(checkSnapDistance([0, 0, 0], [0, 0, 0], NaN), false)
  assert.equal(checkSnapDistance([0, 0, 0], [0, 0, 0], -1), false)
  assert.equal(checkSnapDistance([0, 0, 0], [0, 0, 0], Infinity), false)
})

test('tryAssembleComponent：阈值内且已加工才会真正组装', () => {
  markAllProcessed()
  const seat = getComponents().find(c => c.type === 'seat')!
  assert.equal(tryAssembleComponent(seat.id, [...seat.targetPosition] as [number, number, number], 1.5), true)
  assert.equal(getComponents().find(c => c.id === seat.id)!.assembled, true)
})

test('tryAssembleComponent：落点超出阈值不改变状态', () => {
  markAllProcessed()
  const seat = getComponents().find(c => c.type === 'seat')!
  const far: [number, number, number] = [
    seat.targetPosition[0] + 10,
    seat.targetPosition[1],
    seat.targetPosition[2],
  ]
  assert.equal(tryAssembleComponent(seat.id, far, 1.5), false)
  assert.equal(getComponents().find(c => c.id === seat.id)!.assembled, false)
})

test('tryAssembleComponent：未加工构件即使落在目标点也不组装', () => {
  const seat = componentOf('seat')
  assert.equal(
    tryAssembleComponent(seat.id, [...seat.targetPosition] as [number, number, number], 1.5),
    false
  )
  assert.equal(componentOf('seat').assembled, false)
})

test('tryAssembleComponent：缺失位置 / 未知 id 安全失败', () => {
  markAllProcessed()
  const seat = getComponents().find(c => c.type === 'seat')!
  assert.equal(tryAssembleComponent(seat.id, null, 1.5), false)
  assert.equal(tryAssembleComponent(seat.id, undefined, 1.5), false)
  assert.equal(tryAssembleComponent('missing', [0, 0, 0], 1.5), false)
  assert.equal(getComponents().find(c => c.id === seat.id)!.assembled, false)
})
