import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  getComponents,
  markComponentProcessed,
  markAllProcessed,
  assembleComponent,
  canDragComponent,
  isAssemblyComplete,
  getCurrentStep,
} from '../src/Assembly.ts'
import { resetAll, componentOf, allTypes } from './helpers.ts'

beforeEach(resetAll)

test('初始状态：全部构件未加工、未组装，步骤为 select', () => {
  const components = getComponents()
  assert.equal(components.length, 4)
  for (const c of components) {
    assert.equal(c.processed, false)
    assert.equal(c.assembled, false)
    assert.equal(canDragComponent(c), false)
  }
  assert.equal(getCurrentStep(), 'select')
  assert.equal(isAssemblyComplete(), false)
})

test('未加工的构件不允许组装（前置关系）', () => {
  const seat = componentOf('seat')
  assert.equal(assembleComponent(seat.id), false)
  assert.equal(componentOf('seat').assembled, false)
  assert.equal(isAssemblyComplete(), false)
})

test('加工完成标记与可拖拽条件一致', () => {
  markComponentProcessed('seat')
  const seat = componentOf('seat')
  assert.equal(seat.processed, true)
  assert.equal(canDragComponent(seat), true)
  // 其余构件仍未加工、不可拖拽
  for (const type of allTypes().filter(t => t !== 'seat')) {
    const c = componentOf(type)
    assert.equal(c.processed, false)
    assert.equal(canDragComponent(c), false)
  }
})

test('markAllProcessed 后全部构件可拖拽，组装后置为不可拖拽', () => {
  markAllProcessed()
  for (const c of getComponents()) {
    assert.equal(canDragComponent(c), true)
  }
  const seat = componentOf('seat')
  assert.equal(assembleComponent(seat.id), true)
  assert.equal(canDragComponent(componentOf('seat')), false)
})

test('已加工的构件组装成功并吸附到目标位置', () => {
  markComponentProcessed('backrest')
  const before = componentOf('backrest')
  assert.equal(assembleComponent(before.id), true)
  const after = componentOf('backrest')
  assert.equal(after.assembled, true)
  assert.deepEqual(after.position, after.targetPosition)
})

test('重复组装同一构件幂等：第二次返回 false 且状态不变', () => {
  markComponentProcessed('seat')
  const seat = componentOf('seat')
  assert.equal(assembleComponent(seat.id), true)
  assert.equal(assembleComponent(seat.id), false)
  assert.equal(componentOf('seat').assembled, true)
  assert.equal(isAssemblyComplete(), false)
})

test('不存在的构件 id 组装失败且不产生副作用', () => {
  markAllProcessed()
  assert.equal(assembleComponent('no-such-id'), false)
  assert.equal(getComponents().every(c => !c.assembled), true)
})

test('canDragComponent 对空值安全', () => {
  assert.equal(canDragComponent(null), false)
  assert.equal(canDragComponent(undefined), false)
})

test('快速连续操作：交替加工与组装，状态始终一致', () => {
  for (const type of allTypes()) {
    markComponentProcessed(type)
    const c = componentOf(type)
    assert.equal(canDragComponent(c), true)
    assert.equal(assembleComponent(c.id), true)
    assert.equal(canDragComponent(componentOf(type)), false)
  }
  assert.equal(isAssemblyComplete(), true)
  assert.equal(getCurrentStep(), 'display')
})
