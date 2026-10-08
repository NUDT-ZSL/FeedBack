import { test, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import {
  getComponents,
  markAllProcessed,
  assembleComponent,
  canDragComponent,
  resetAssembly,
  isAssemblyComplete,
  shouldShowHalo,
  isAutoRotate,
  getCurrentStep,
} from '../src/Assembly.ts'
import {
  getMaterials,
  selectMaterial,
  getSelectedMaterial,
  clearSelection,
} from '../src/Materials.ts'
import { resetAll } from './helpers.ts'

beforeEach(() => {
  resetAll()
  mock.timers.enable({ apis: ['setTimeout'] })
})

afterEach(() => {
  mock.timers.reset()
})

function runToDisplay(): void {
  markAllProcessed()
  for (const c of getComponents()) {
    assembleComponent(c.id)
  }
}

test('重置后构件加工/组装状态与当前步骤回到初始', () => {
  runToDisplay()
  assert.equal(isAssemblyComplete(), true)
  resetAssembly()
  const components = getComponents()
  assert.equal(components.length, 4)
  for (const c of components) {
    assert.equal(c.processed, false)
    assert.equal(c.assembled, false)
    assert.equal(canDragComponent(c), false)
  }
  assert.equal(isAssemblyComplete(), false)
  assert.equal(shouldShowHalo(), false)
  assert.equal(isAutoRotate(), false)
  assert.equal(getCurrentStep(), 'select')
})

test('重置取消未结束的光环定时器，不残留延迟副作用', () => {
  runToDisplay()
  assert.equal(shouldShowHalo(), true)
  // 光环未结束就重置
  resetAssembly()
  mock.timers.tick(5000)
  assert.equal(shouldShowHalo(), false)
  assert.equal(isAutoRotate(), false)
})

test('重置后构件 id 保持稳定，可重新走完整流程', () => {
  const before = getComponents().map(c => c.id)
  runToDisplay()
  resetAssembly()
  const after = getComponents().map(c => c.id)
  assert.deepEqual(after, before)
  // 重置后可以再次完整加工并组装
  runToDisplay()
  assert.equal(isAssemblyComplete(), true)
  assert.equal(getCurrentStep(), 'display')
})

test('连续多次重置安全且状态一致', () => {
  runToDisplay()
  resetAssembly()
  resetAssembly()
  resetAssembly()
  assert.equal(getCurrentStep(), 'select')
  assert.equal(isAssemblyComplete(), false)
  assert.equal(getComponents().every(c => !c.processed && !c.assembled), true)
})

test('木料初始均未选中，clearSelection 清空选择', () => {
  assert.equal(getSelectedMaterial(), null)
  const first = getMaterials()[0]
  selectMaterial(first.id)
  assert.equal(getSelectedMaterial()?.id, first.id)
  clearSelection()
  assert.equal(getSelectedMaterial(), null)
})

test('重选木料：旧选择被替换，加工与组装结果不残留', () => {
  const materials = getMaterials()
  selectMaterial(materials[0].id)
  markAllProcessed()
  const seat = getComponents()[0]
  assembleComponent(seat.id)
  assert.equal(getComponents().some(c => c.assembled), true)

  const selected = selectMaterial(materials[1].id)
  assert.equal(selected?.id, materials[1].id)
  assert.equal(getSelectedMaterial()?.id, materials[1].id)
  assert.equal(getMaterials().filter(m => m.selected).length, 1)
  // 上一轮加工/组装结果全部清空
  for (const c of getComponents()) {
    assert.equal(c.processed, false)
    assert.equal(c.assembled, false)
  }
  assert.equal(isAssemblyComplete(), false)
})

test('重选同一木料同样复位组装状态', () => {
  const materials = getMaterials()
  selectMaterial(materials[0].id)
  markAllProcessed()
  assembleComponent(getComponents()[0].id)
  selectMaterial(materials[0].id)
  assert.equal(getSelectedMaterial()?.id, materials[0].id)
  assert.equal(getComponents().every(c => !c.processed && !c.assembled), true)
})

test('展示态下重选木料：展示效果一并清除', () => {
  const materials = getMaterials()
  selectMaterial(materials[0].id)
  runToDisplay()
  assert.equal(isAssemblyComplete(), true)
  assert.equal(shouldShowHalo(), true)
  selectMaterial(materials[2].id)
  assert.equal(isAssemblyComplete(), false)
  assert.equal(shouldShowHalo(), false)
  assert.equal(isAutoRotate(), false)
  mock.timers.tick(5000)
  assert.equal(isAutoRotate(), false)
})

test('选择不存在的木料 id：返回 null 且不改变现有状态', () => {
  const materials = getMaterials()
  selectMaterial(materials[0].id)
  markAllProcessed()
  const result = selectMaterial('no-such-material')
  assert.equal(result, null)
  assert.equal(getSelectedMaterial()?.id, materials[0].id)
  assert.equal(getComponents().every(c => c.processed), true)
})
