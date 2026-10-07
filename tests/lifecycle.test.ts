import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ManualClock } from '../src/core/capsule/clock.ts'
import { CapsuleError, CapsuleService } from '../src/core/capsule/service.ts'

const T0 = 1_700_000_000_000

test('生命周期：创建-多次编辑-投递-解锁，状态/内容/时间戳保持一致', () => {
  const clock = new ManualClock(T0)
  const service = new CapsuleService(clock)

  const created = service.create({
    id: 'cap-1',
    title: '给未来的自己',
    content: 'v1',
    deliverAt: T0 + 60_000,
  })
  assert.equal(created.version, 1)
  assert.equal(created.createdAt, T0)
  assert.equal(created.updatedAt, T0)
  assert.equal(created.openedAt, null)
  assert.equal(service.getStatus('cap-1'), 'sealed')

  clock.advance(1_000)
  const edited1 = service.edit('cap-1', { expectedVersion: 1, content: 'v2' })
  assert.equal(edited1.content, 'v2')
  assert.equal(edited1.version, 2)
  assert.equal(edited1.createdAt, T0, 'createdAt 不可变')
  assert.equal(edited1.updatedAt, T0 + 1_000)

  clock.advance(1_000)
  const edited2 = service.edit('cap-1', {
    expectedVersion: 2,
    title: '改标题',
    deliverAt: T0 + 120_000,
  })
  assert.equal(edited2.title, '改标题')
  assert.equal(edited2.content, 'v2', '未提交的字段不被覆盖')
  assert.equal(edited2.deliverAt, T0 + 120_000)
  assert.equal(edited2.version, 3)

  clock.set(T0 + 120_000)
  assert.equal(service.getStatus('cap-1'), 'deliverable')

  const opened = service.unlock('cap-1')
  assert.equal(opened.status, 'opened')
  assert.equal(opened.openedAt, T0 + 120_000)
  assert.equal(opened.version, 4)
  assert.equal(opened.content, 'v2', '解锁后内容与最后一次编辑一致')
  assert.equal(opened.createdAt, T0)
})

test('状态不回退：解锁后禁止编辑，重复解锁保持首次 openedAt', () => {
  const clock = new ManualClock(T0)
  const service = new CapsuleService(clock)
  service.create({ id: 'cap-2', title: 't', content: 'c', deliverAt: T0 })

  clock.advance(5_000)
  const first = service.unlock('cap-2')
  assert.equal(first.openedAt, T0 + 5_000)

  clock.advance(10_000)
  const second = service.unlock('cap-2')
  assert.equal(second.openedAt, T0 + 5_000, '重复解锁不得改写 openedAt')
  assert.equal(second.version, first.version, '重复解锁不得递增版本')

  assert.throws(
    () => service.edit('cap-2', { expectedVersion: first.version, content: 'hack' }),
    (error: unknown) => error instanceof CapsuleError && error.code === 'ALREADY_OPENED',
  )
  assert.equal(service.get('cap-2').content, 'c', '解锁后内容不可被修改')
  assert.equal(service.getStatus('cap-2'), 'opened')
})

test('读取操作不产生隐式状态迁移', () => {
  const clock = new ManualClock(T0)
  const service = new CapsuleService(clock)
  service.create({ id: 'cap-3', title: 't', content: 'c', deliverAt: T0 + 1_000 })

  clock.set(T0 + 1_000)
  assert.equal(service.getStatus('cap-3'), 'deliverable')
  const capsule = service.get('cap-3')
  assert.equal(capsule.status, 'sealed', 'getStatus 不得把内存状态直接改为 opened')
  assert.equal(capsule.version, 1)
})
