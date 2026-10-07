import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ManualClock } from '../src/core/capsule/clock.ts'
import { CapsuleError, CapsuleService } from '../src/core/capsule/service.ts'

const T0 = 1_900_000_000_000

test('重复提交相同输入：相同 operationId 幂等，不重复生效', () => {
  const clock = new ManualClock(T0)
  const service = new CapsuleService(clock)

  const created = service.create({ id: 'cap', title: 't', content: 'v0', deliverAt: T0 + 1, operationId: 'op-create' })
  assert.equal(created.version, 1)

  // 网络重试导致 create 重复提交
  const retried = service.create({ id: 'cap', title: 't', content: 'should-be-ignored', deliverAt: T0 + 1, operationId: 'op-create' })
  assert.equal(retried.content, 'v0', '重复创建提交被幂等忽略')
  assert.equal(retried.version, 1)
  assert.deepEqual(retried.appliedOperations, ['op-create'])

  clock.advance(1_000)
  const edited = service.edit('cap', { expectedVersion: 1, content: 'v1', operationId: 'op-edit-1' })
  assert.equal(edited.version, 2)

  // edit 重复提交（同样 expectedVersion 也已过期）
  const editRetry = service.edit('cap', { expectedVersion: 1, content: 'v1', operationId: 'op-edit-1' })
  assert.equal(editRetry.version, 2, '重复编辑不产生新版本')
  assert.equal(editRetry.content, 'v1')
})

test('冲突提交：过期 expectedVersion 被明确拒绝，不静默择一', () => {
  const clock = new ManualClock(T0)
  const service = new CapsuleService(clock)
  service.create({ id: 'cap', title: 't', content: 'base', deliverAt: T0 + 10_000 })

  // 两个客户端都基于版本 1 提交，A 先成功
  clock.advance(100)
  const a = service.edit('cap', { expectedVersion: 1, content: 'from-A' })
  assert.equal(a.version, 2)
  assert.equal(a.content, 'from-A')

  // B 基于过期版本 1，必须失败而不是覆盖 A 的结果
  assert.throws(
    () => service.edit('cap', { expectedVersion: 1, content: 'from-B' }),
    (error: unknown) => error instanceof CapsuleError && error.code === 'VERSION_CONFLICT',
  )

  const final = service.get('cap')
  assert.equal(final.content, 'from-A', '冲突时结果由操作顺序决定，后来的过期写入不覆盖')
  assert.equal(final.version, 2)
})

test('顺序冲突：基于最新版本重试成功，最终状态可预测', () => {
  const clock = new ManualClock(T0)
  const service = new CapsuleService(clock)
  service.create({ id: 'cap', title: 't', content: 'base', deliverAt: T0 + 10_000 })

  for (let i = 0; i < 3; i += 1) {
    const current = service.get('cap')
    const next = service.edit('cap', { expectedVersion: current.version, content: `step-${i}` })
    assert.equal(next.version, i + 2)
    assert.equal(next.content, `step-${i}`)
  }
  assert.equal(service.get('cap').content, 'step-2')
})

test('解锁重复提交幂等，且不覆盖首次解锁时刻', () => {
  const clock = new ManualClock(T0)
  const service = new CapsuleService(clock)
  service.create({ id: 'cap', title: 't', content: 'c', deliverAt: T0 })

  clock.advance(500)
  const first = service.unlock('cap', { operationId: 'op-unlock' })
  clock.advance(5_000)
  const retry = service.unlock('cap', { operationId: 'op-unlock' })
  assert.equal(retry.openedAt, first.openedAt)
  assert.equal(retry.version, first.version)
})

test('非法输入在创建时即被拒绝，不产生残留记录', () => {
  const clock = new ManualClock(T0)
  const service = new CapsuleService(clock)

  assert.throws(
    () => service.create({ id: 'x', title: '', content: 'c', deliverAt: T0 }),
    (error: unknown) => error instanceof CapsuleError && error.code === 'INVALID_INPUT',
  )
  assert.throws(
    () => service.create({ id: 'y', title: 't', content: 'c', deliverAt: NaN }),
    (error: unknown) => error instanceof CapsuleError && error.code === 'INVALID_INPUT',
  )
  assert.throws(
    () => service.get('x'),
    (error: unknown) => error instanceof CapsuleError && error.code === 'NOT_FOUND',
  )
})
