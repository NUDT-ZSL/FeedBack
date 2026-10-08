import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkSnapDistance } from '../src/Assembly.ts'

const target: [number, number, number] = [0, 1.2, 0]

test('落点在默认阈值内判定为吸附成功', () => {
  assert.equal(checkSnapDistance([0, 1.2, 0], target), true)
  assert.equal(checkSnapDistance([0.3, 1.2, 0], target), true)
  assert.equal(checkSnapDistance([0.2, 1.4, -0.2], target), true)
})

test('落点超出阈值判定为失败', () => {
  assert.equal(checkSnapDistance([1, 1.2, 0], target), false)
  assert.equal(checkSnapDistance([0.4, 1.2, 0.4], target), false)
  assert.equal(checkSnapDistance([5, 5, 5], target), false)
})

test('距离恰好等于阈值时不算阈值内（严格小于）', () => {
  assert.equal(checkSnapDistance([0.5, 1.2, 0], target, 0.5), false)
  assert.equal(checkSnapDistance([0.3, 1.2, 0.4], target, 0.5), false)
})

test('自定义阈值生效', () => {
  assert.equal(checkSnapDistance([1.4, 1.2, 0], target, 1.5), true)
  assert.equal(checkSnapDistance([1.6, 1.2, 0], target, 1.5), false)
})

test('位置缺失或结构异常时不误判为成功', () => {
  assert.equal(checkSnapDistance(undefined as any, target), false)
  assert.equal(checkSnapDistance(null as any, target), false)
  assert.equal(checkSnapDistance([0, 1.2] as any, target), false)
  assert.equal(checkSnapDistance([0, 1.2, 0, 9] as any, target), false)
  assert.equal(checkSnapDistance([0, 1.2, 0], undefined as any), false)
  assert.equal(checkSnapDistance([0, 1.2, 0], [0, 1.2] as any), false)
})

test('坐标含 NaN / Infinity 时不误判为成功', () => {
  assert.equal(checkSnapDistance([NaN, 1.2, 0], target), false)
  assert.equal(checkSnapDistance([Infinity, 1.2, 0], target), false)
  assert.equal(checkSnapDistance([-Infinity, 1.2, 0], target), false)
  assert.equal(checkSnapDistance([0, 1.2, 0], [NaN, 1.2, 0]), false)
  assert.equal(checkSnapDistance([0, 1.2, 0], [0, Infinity, 0]), false)
})

test('阈值异常（NaN / 负数 / Infinity）时不误判为成功', () => {
  assert.equal(checkSnapDistance([0, 1.2, 0], target, NaN), false)
  assert.equal(checkSnapDistance([0, 1.2, 0], target, -1), false)
  assert.equal(checkSnapDistance([0, 1.2, 0], target, Infinity), false)
})
