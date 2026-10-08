import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  getComponents,
  markComponentProcessed,
  markAllProcessed,
  assembleComponent,
  checkAssemblyComplete,
  isAssemblyComplete,
  shouldShowHalo,
  isAutoRotate,
  getCurrentStep,
  resetAssembly,
  type FurnitureComponent
} from '../src/Assembly.ts'

// 与 UI.tsx 中构件卡片 draggable 条件保持一致
function isDraggable(component: FurnitureComponent): boolean {
  return component.processed && !component.assembled
}

beforeEach(() => {
  resetAssembly()
})

test('初始状态：全部未加工、未组装，步骤为 select', () => {
  const components = getComponents()
  assert.equal(components.length, 4)
  for (const c of components) {
    assert.equal(c.processed, false)
    assert.equal(c.assembled, false)
    assert.equal(isDraggable(c), false)
  }
  assert.equal(getCurrentStep(), 'select')
  assert.equal(isAssemblyComplete(), false)
})

test('未加工完成的构件不可组装', () => {
  const [seat] = getComponents()
  assert.equal(assembleComponent(seat.id), false)
  const after = getComponents().find(c => c.id === seat.id)!
  assert.equal(after.assembled, false)
  assert.equal(isAssemblyComplete(), false)
})

test('单个构件加工完成后才可组装，且与可拖拽条件一致', () => {
  markComponentProcessed('seat')
  const components = getComponents()
  const seat = components.find(c => c.type === 'seat')!
  const armrest = components.find(c => c.type === 'armrest')!

  assert.equal(isDraggable(seat), true)
  assert.equal(isDraggable(armrest), false)

  assert.equal(assembleComponent(armrest.id), false)
  assert.equal(assembleComponent(seat.id), true)

  const after = getComponents()
  assert.equal(after.find(c => c.type === 'seat')!.assembled, true)
  assert.equal(after.find(c => c.type === 'armrest')!.assembled, false)
})

test('组装成功后构件位置吸附到目标位置，且不再可拖拽', () => {
  markAllProcessed()
  const seat = getComponents().find(c => c.type === 'seat')!
  assert.equal(assembleComponent(seat.id), true)
  const after = getComponents().find(c => c.type === 'seat')!
  assert.deepEqual(after.position, after.targetPosition)
  assert.equal(isDraggable(after), false)
})

test('全部加工并组装后进入展示态并触发光环', () => {
  markAllProcessed()
  for (const c of getComponents()) {
    assert.equal(assembleComponent(c.id), true)
  }
  assert.equal(isAssemblyComplete(), true)
  assert.equal(getCurrentStep(), 'display')
  assert.equal(shouldShowHalo(), true)
})

test('光环结束后自动进入 360 度旋转展示', async () => {
  markAllProcessed()
  for (const c of getComponents()) {
    assembleComponent(c.id)
  }
  assert.equal(shouldShowHalo(), true)
  assert.equal(isAutoRotate(), false)
  await new Promise(resolve => setTimeout(resolve, 1600))
  assert.equal(shouldShowHalo(), false)
  assert.equal(isAutoRotate(), true)
})

test('组装完成状态重复触发不产生重复或覆盖效果', () => {
  markAllProcessed()
  for (const c of getComponents()) {
    assembleComponent(c.id)
  }
  assert.equal(isAssemblyComplete(), true)
  assert.equal(getCurrentStep(), 'display')

  // 重复检查完成状态：状态保持展示态，不重复翻转
  assert.equal(checkAssemblyComplete(), true)
  assert.equal(getCurrentStep(), 'display')
  assert.equal(isAssemblyComplete(), true)

  // 对已组装构件重复组装：幂等拒绝，不重复触发
  const seat = getComponents().find(c => c.type === 'seat')!
  assert.equal(assembleComponent(seat.id), false)
  assert.equal(getCurrentStep(), 'display')
  assert.equal(isAssemblyComplete(), true)
})

test('部分组装时不进入展示态', () => {
  markAllProcessed()
  const components = getComponents()
  for (const c of components.slice(0, 3)) {
    assert.equal(assembleComponent(c.id), true)
  }
  assert.equal(isAssemblyComplete(), false)
  assert.notEqual(getCurrentStep(), 'display')
  assert.equal(shouldShowHalo(), false)
})

test('不存在的构件 id 组装失败且不影响状态', () => {
  markAllProcessed()
  assert.equal(assembleComponent('non-existent-id'), false)
  assert.equal(isAssemblyComplete(), false)
  assert.equal(getComponents().every(c => !c.assembled), true)
})
