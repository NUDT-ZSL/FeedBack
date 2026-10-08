import { test, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import {
  markAllProcessed,
  assembleComponent,
  checkAssemblyComplete,
  triggerHalo,
  isAssemblyComplete,
  shouldShowHalo,
  isAutoRotate,
  getCurrentStep,
  getComponents,
} from '../src/Assembly.ts'
import { resetAll } from './helpers.ts'

beforeEach(() => {
  resetAll()
  mock.timers.enable({ apis: ['setTimeout'] })
})

afterEach(() => {
  mock.timers.reset()
})

function assembleAll(): void {
  markAllProcessed()
  for (const c of getComponents()) {
    assembleComponent(c.id)
  }
}

test('全部构件组装完成后进入展示态', () => {
  assembleAll()
  assert.equal(isAssemblyComplete(), true)
  assert.equal(getCurrentStep(), 'display')
  assert.equal(shouldShowHalo(), true)
  assert.equal(isAutoRotate(), false)
})

test('光环结束后自动开启旋转展示', () => {
  assembleAll()
  mock.timers.tick(1500)
  assert.equal(shouldShowHalo(), false)
  assert.equal(isAutoRotate(), true)
})

test('未全部组装时不进入展示态', () => {
  markAllProcessed()
  const components = getComponents()
  for (const c of components.slice(0, 3)) {
    assembleComponent(c.id)
  }
  assert.equal(isAssemblyComplete(), false)
  assert.notEqual(getCurrentStep(), 'display')
  assert.equal(shouldShowHalo(), false)
})

test('重复调用 checkAssemblyComplete 不重复触发展示效果', () => {
  assembleAll()
  mock.timers.tick(1500)
  assert.equal(isAutoRotate(), true)
  // 再次触发完成检查：状态保持稳定，无重复效果
  assert.equal(checkAssemblyComplete(), true)
  assert.equal(checkAssemblyComplete(), true)
  assert.equal(isAssemblyComplete(), true)
  assert.equal(getCurrentStep(), 'display')
  assert.equal(shouldShowHalo(), false)
  assert.equal(isAutoRotate(), true)
})

test('重复触发 triggerHalo 幂等：光环只调度一次', () => {
  const realSetTimeout = globalThis.setTimeout
  let scheduled = 0
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    scheduled += 1
    return realSetTimeout(...args)
  }) as typeof setTimeout
  try {
    triggerHalo()
    triggerHalo()
    triggerHalo()
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
  assert.equal(scheduled, 1)
  assert.equal(shouldShowHalo(), true)
  mock.timers.tick(1500)
  assert.equal(shouldShowHalo(), false)
  assert.equal(isAutoRotate(), true)
})

test('重复组装最后一个构件不会重复触发展示效果', () => {
  markAllProcessed()
  const components = getComponents()
  for (const c of components.slice(0, 3)) {
    assembleComponent(c.id)
  }
  const last = components[3]
  assert.equal(assembleComponent(last.id), true)
  assert.equal(isAssemblyComplete(), true)
  mock.timers.tick(1500)
  assert.equal(isAutoRotate(), true)
  // 快速重复点击同一构件：第二次组装被拒绝，展示态不被覆盖
  assert.equal(assembleComponent(last.id), false)
  assert.equal(shouldShowHalo(), false)
  assert.equal(isAutoRotate(), true)
  assert.equal(getCurrentStep(), 'display')
})

test('真实定时器下光环流程可完整走完（非假时钟）', async () => {
  mock.timers.reset()
  assembleAll()
  assert.equal(shouldShowHalo(), true)
  await new Promise(resolve => setTimeout(resolve, 1600))
  assert.equal(shouldShowHalo(), false)
  assert.equal(isAutoRotate(), true)
})
