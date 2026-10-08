import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  getComponents,
  markAllProcessed,
  assembleComponent,
  isAssemblyComplete,
  shouldShowHalo,
  isAutoRotate,
  getCurrentStep,
  setCurrentStep,
  resetAssembly
} from '../src/Assembly.ts'
import {
  getMaterials,
  selectMaterial,
  getSelectedMaterial,
  clearSelection
} from '../src/Materials.ts'

beforeEach(() => {
  resetAssembly()
  clearSelection()
})

test('重置后加工、组装状态与当前步骤全部回到初始', () => {
  markAllProcessed()
  for (const c of getComponents()) {
    assembleComponent(c.id)
  }
  assert.equal(isAssemblyComplete(), true)
  assert.equal(getCurrentStep(), 'display')

  resetAssembly()

  const components = getComponents()
  assert.equal(components.length, 4)
  for (const c of components) {
    assert.equal(c.processed, false)
    assert.equal(c.assembled, false)
  }
  assert.equal(isAssemblyComplete(), false)
  assert.equal(shouldShowHalo(), false)
  assert.equal(isAutoRotate(), false)
  assert.equal(getCurrentStep(), 'select')
})

test('重置后构件回到初始摆放位置而非目标位置', () => {
  markAllProcessed()
  for (const c of getComponents()) {
    assembleComponent(c.id)
  }
  resetAssembly()
  for (const c of getComponents()) {
    assert.notDeepEqual(c.position, c.targetPosition)
  }
})

test('展示态触发后立即重置，残留的展示效果不会复活', async () => {
  markAllProcessed()
  for (const c of getComponents()) {
    assembleComponent(c.id)
  }
  assert.equal(shouldShowHalo(), true)

  resetAssembly()
  assert.equal(shouldShowHalo(), false)
  assert.equal(isAutoRotate(), false)

  // 等待原光环计时器到期，确认不会把 autoRotate 重新打开
  await new Promise(resolve => setTimeout(resolve, 1600))
  assert.equal(shouldShowHalo(), false)
  assert.equal(isAutoRotate(), false)
  assert.equal(getCurrentStep(), 'select')
})

test('重置后可重新走完整流程', () => {
  markAllProcessed()
  for (const c of getComponents()) {
    assembleComponent(c.id)
  }
  resetAssembly()

  markAllProcessed()
  for (const c of getComponents()) {
    assert.equal(assembleComponent(c.id), true)
  }
  assert.equal(isAssemblyComplete(), true)
  assert.equal(getCurrentStep(), 'display')
})

test('选择木料后仅当前木料被选中', () => {
  const materials = getMaterials()
  assert.ok(materials.length >= 2)
  const selected = selectMaterial(materials[0].id)
  assert.equal(selected?.id, materials[0].id)
  assert.equal(getSelectedMaterial()?.id, materials[0].id)
  assert.equal(getMaterials().filter(m => m.selected).length, 1)
})

test('重选木料不残留上一次的选择', () => {
  const materials = getMaterials()
  selectMaterial(materials[0].id)
  selectMaterial(materials[1].id)

  const selected = getMaterials().filter(m => m.selected)
  assert.equal(selected.length, 1)
  assert.equal(selected[0].id, materials[1].id)
  assert.equal(getSelectedMaterial()?.id, materials[1].id)
})

test('选择不存在的木料返回 null 且清空已有选择', () => {
  const materials = getMaterials()
  selectMaterial(materials[0].id)
  const result = selectMaterial('non-existent-id')
  assert.equal(result, null)
  assert.equal(getSelectedMaterial(), null)
})

test('重选木料并清除选择后，组装结果不残留', () => {
  const materials = getMaterials()
  selectMaterial(materials[0].id)
  setCurrentStep('assemble')
  markAllProcessed()
  for (const c of getComponents()) {
    assembleComponent(c.id)
  }
  assert.equal(isAssemblyComplete(), true)

  // 模拟重选流程：重置组装 + 清除木料选择 + 选择新木料
  resetAssembly()
  clearSelection()
  selectMaterial(materials[1].id)

  assert.equal(getSelectedMaterial()?.id, materials[1].id)
  assert.equal(getMaterials().filter(m => m.selected).length, 1)
  assert.equal(isAssemblyComplete(), false)
  assert.equal(getCurrentStep(), 'select')
  for (const c of getComponents()) {
    assert.equal(c.processed, false)
    assert.equal(c.assembled, false)
  }
})
