import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ManualClock } from '../src/core/capsule/clock.ts'
import { CapsuleError, CapsuleService, sha256 } from '../src/core/capsule/service.ts'

const DELIVER_AT = 1_800_000_000_000

function makeService(clock: ManualClock, condition?: Parameters<CapsuleService['create']>[0]['unlockCondition']) {
  const service = new CapsuleService(clock)
  service.create({ id: 'cap', title: 't', content: 'secret', deliverAt: DELIVER_AT, unlockCondition: condition })
  return service
}

test('投递时间之前必须保持锁定，错误携带可重试时刻', () => {
  const clock = new ManualClock(DELIVER_AT - 1)
  const service = makeService(clock)

  assert.equal(service.getStatus('cap'), 'sealed')
  assert.throws(
    () => service.unlock('cap'),
    (error: unknown) =>
      error instanceof CapsuleError &&
      error.code === 'LOCKED_BEFORE_DELIVERY' &&
      error.retryAt === DELIVER_AT,
  )
  assert.equal(service.get('cap').status, 'sealed', '解锁失败后状态不变')
  assert.equal(service.get('cap').version, 1, '解锁失败后版本不变')
})

test('边界：恰好等于投递时间时必须解锁（确定结论）', () => {
  const clock = new ManualClock(DELIVER_AT)
  const service = makeService(clock)

  assert.equal(service.getStatus('cap'), 'deliverable')
  const opened = service.unlock('cap')
  assert.equal(opened.status, 'opened')
  assert.equal(opened.openedAt, DELIVER_AT)
})

test('投递时间之后必须解锁', () => {
  const clock = new ManualClock(DELIVER_AT + 1)
  const service = makeService(clock)
  assert.equal(service.getStatus('cap'), 'deliverable')
  assert.equal(service.unlock('cap').status, 'opened')
})

test('附加时间条件：条件刚好满足（等于边界）即可解锁，差 1ms 仍锁定', () => {
  const NOT_BEFORE = DELIVER_AT + 3_600_000
  const clock = new ManualClock(NOT_BEFORE - 1)
  const service = makeService(clock, { type: 'after', notBefore: NOT_BEFORE })

  // 投递时间已过，但附加条件未满足
  assert.equal(service.getStatus('cap'), 'sealed')
  assert.throws(
    () => service.unlock('cap'),
    (error: unknown) => error instanceof CapsuleError && error.code === 'CONDITION_NOT_MET',
  )

  clock.set(NOT_BEFORE)
  assert.equal(service.getStatus('cap'), 'deliverable', '条件边界时刻必须给出确定的可解锁结论')
  assert.equal(service.unlock('cap').status, 'opened')
})

test('口令条件：错误口令拒绝且不改变状态，正确口令解锁', () => {
  const clock = new ManualClock(DELIVER_AT)
  const service = makeService(clock, { type: 'passphrase', hash: sha256('open-sesame') })

  assert.throws(
    () => service.unlock('cap', { passphrase: 'wrong' }),
    (error: unknown) => error instanceof CapsuleError && error.code === 'CONDITION_NOT_MET',
  )
  assert.throws(
    () => service.unlock('cap'),
    (error: unknown) => error instanceof CapsuleError && error.code === 'CONDITION_NOT_MET',
  )
  assert.equal(service.get('cap').status, 'sealed')

  const opened = service.unlock('cap', { passphrase: 'open-sesame' })
  assert.equal(opened.status, 'opened')
})
