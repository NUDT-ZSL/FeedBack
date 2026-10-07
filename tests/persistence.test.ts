import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ManualClock } from '../src/core/capsule/clock.ts'
import { CapsuleService, sha256 } from '../src/core/capsule/service.ts'
import { JsonCapsuleStore, StoreError } from '../src/core/capsule/store.ts'

const T0 = 1_600_000_000_000
let tempDir: string
let dbPath: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'capsule-test-'))
  dbPath = path.join(tempDir, 'capsules.json')
})

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

test('持久化：保存后重新加载，内存状态与磁盘一致', async () => {
  const clock = new ManualClock(T0)
  const service = new CapsuleService(clock)

  service.create({ id: 'a', title: '标题', content: '正文', deliverAt: T0 + 10_000 })
  clock.advance(1_000)
  service.edit('a', { expectedVersion: 1, content: '正文v2', operationId: 'edit-1' })
  service.create({
    id: 'b',
    title: 'b',
    content: 'c',
    deliverAt: T0,
    unlockCondition: { type: 'passphrase', hash: sha256('pw') },
  })
  clock.set(T0 + 10_000)
  service.unlock('a', { operationId: 'unlock-a' })

  const store = new JsonCapsuleStore(dbPath)
  await store.save(service.snapshot())

  const loaded = await store.loadStrict()
  const restored = new CapsuleService(new ManualClock(T0 + 20_000))
  restored.restore(loaded)

  assert.deepEqual(
    restored.list().map(({ id }) => id).sort(),
    ['a', 'b'],
  )
  const a = restored.get('a')
  assert.equal(a.content, '正文v2')
  assert.equal(a.version, 3)
  assert.equal(a.status, 'opened')
  assert.equal(a.openedAt, T0 + 10_000)
  assert.deepEqual(a.appliedOperations, ['edit-1', 'unlock-a'])
  const b = restored.get('b')
  assert.deepEqual(b.unlockCondition, { type: 'passphrase', hash: sha256('pw') })
  assert.equal(restored.getStatus('a'), 'opened')
})

test('持久化：文件缺失被明确识别（FILE_MISSING），不被当作空数据', async () => {
  const store = new JsonCapsuleStore(dbPath)
  await assert.rejects(
    () => store.load(),
    (error: unknown) => error instanceof StoreError && error.code === 'FILE_MISSING',
  )
})

test('持久化：JSON 损坏被明确识别（FILE_CORRUPT）', async () => {
  await fs.writeFile(dbPath, '{ this is not json', 'utf8')
  const store = new JsonCapsuleStore(dbPath)
  await assert.rejects(
    () => store.load(),
    (error: unknown) => error instanceof StoreError && error.code === 'FILE_CORRUPT',
  )

  await fs.writeFile(dbPath, JSON.stringify({ unexpected: true }), 'utf8')
  await assert.rejects(
    () => store.load(),
    (error: unknown) => error instanceof StoreError && error.code === 'FILE_CORRUPT',
  )
})

test('持久化：单条记录损坏或缺失字段被逐条识别，不被静默跳过', async () => {
  const good: unknown = {
    id: 'good',
    title: 'g',
    content: 'c',
    deliverAt: T0,
    unlockCondition: { type: 'none' },
    status: 'sealed',
    version: 1,
    createdAt: T0,
    updatedAt: T0,
    openedAt: null,
    appliedOperations: [],
  }
  const brokenField = {
    ...(good as object),
    id: 'bad-field',
    deliverAt: 'not-a-number',
  }
  const inconsistent = {
    ...(good as object),
    id: 'bad-state',
    status: 'opened',
    openedAt: null,
  }
  const dupId = { ...(good as object) }

  await fs.writeFile(
    dbPath,
    JSON.stringify({ version: 1, capsules: [good, brokenField, inconsistent, dupId] }),
    'utf8',
  )

  const result = await new JsonCapsuleStore(dbPath).load()
  assert.equal(result.capsules.length, 1, '只有合法记录被加载')
  assert.equal(result.capsules[0].id, 'good')

  assert.equal(result.defects.length, 3)
  const byId = Object.fromEntries(result.defects.map((d) => [d.id ?? '', d]))
  assert.ok(byId['bad-field'].reasons.some((r) => r.includes('deliverAt')))
  assert.ok(byId['bad-state'].reasons.some((r) => r.includes('opened')))
  assert.ok(byId['good'].reasons.some((r) => r.includes('duplicate id')))

  await assert.rejects(
    () => new JsonCapsuleStore(dbPath).loadStrict(),
    (error: unknown) => error instanceof StoreError && error.code === 'RECORD_DEFECTS',
  )
})

test('持久化：原子写入不会留下临时文件', async () => {
  const store = new JsonCapsuleStore(dbPath)
  const service = new CapsuleService(new ManualClock(T0))
  service.create({ id: 'a', title: 't', content: 'c', deliverAt: T0 })
  await store.save(service.snapshot())

  const entries = await fs.readdir(tempDir)
  assert.deepEqual(entries, ['capsules.json'])
})
