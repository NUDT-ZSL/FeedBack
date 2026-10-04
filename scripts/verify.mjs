/**
 * 批量验证入口：筛选 / 排序 / 收藏顺序三条链路共享状态的一致性
 * 运行方式：npm run verify（离线可运行，无网络依赖）
 */
import assert from 'node:assert/strict'

// ---------- 测试运行器 ----------
let passed = 0
const failures = []
async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  ✗ ${name}`)
    console.log(`    ${String(error?.message ?? error).split('\n').join('\n    ')}`)
  }
}
function group(name) {
  console.log(`\n[${name}]`)
}

// ---------- localStorage 内存模拟（须在加载 store 前安装） ----------
function createStorageMock() {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: key => void map.delete(key),
    clear: () => map.clear(),
    key: i => [...map.keys()][i] ?? null,
    get length() { return map.size }
  }
}
globalThis.localStorage = createStorageMock()

const {
  DEFAULT_FILTER,
  normalizeFilter,
  filterHouses,
  sortHouses,
  selectHouses,
  moveItem
} = await import('../src/utils/listQuery.ts')
const { createPinia, setActivePinia } = await import('pinia')
const { useHouseStore } = await import('../src/stores/house.ts')

async function freshStore() {
  setActivePinia(createPinia())
  const store = useHouseStore()
  await store.fetchHouses()
  return store
}

// ---------- 测试夹具 ----------
const mk = (id, price, area, layout, publishTime) => ({ id, price, area, layout, publishTime })
const FIXTURES = [
  mk(1, 3000, 50, '一室一厅', 100),
  mk(2, 3000, 80, '两室一厅', 300),
  mk(3, 5000, 50, '两室一厅', 200),
  mk(4, 8000, 120, '三室两厅', 400),
  mk(5, 1500, 30, '一室一厅', 500)
]
const ids = list => list.map(h => h.id)

// ---------- A. 筛选边界 ----------
group('A. 筛选条件与边界')
await test('空筛选（全部 null）返回全部房源且顺序不变', () => {
  assert.deepEqual(ids(filterHouses(FIXTURES, DEFAULT_FILTER)), [1, 2, 3, 4, 5])
})
await test('缺省字段（undefined）与 null 等价，视为未设置', () => {
  assert.deepEqual(ids(filterHouses(FIXTURES, {})), [1, 2, 3, 4, 5])
  assert.deepEqual(ids(filterHouses(FIXTURES, { priceMin: undefined, layout: undefined })), [1, 2, 3, 4, 5])
})
await test('非法值（NaN / 空字符串户型）按未设置处理', () => {
  assert.deepEqual(ids(filterHouses(FIXTURES, { priceMin: NaN, layout: '' })), [1, 2, 3, 4, 5])
})
await test('单边条件：仅价格下限 / 仅面积上限', () => {
  assert.deepEqual(ids(filterHouses(FIXTURES, { priceMin: 3000 })), [1, 2, 3, 4])
  assert.deepEqual(ids(filterHouses(FIXTURES, { areaMax: 50 })), [1, 3, 5])
})
await test('边界值包含：价格等于下限、面积等于上限均被保留', () => {
  assert.deepEqual(ids(filterHouses(FIXTURES, { priceMin: 3000, priceMax: 3000 })), [1, 2])
  assert.deepEqual(ids(filterHouses(FIXTURES, { areaMin: 50, areaMax: 50 })), [1, 3])
})
await test('条件叠加：价格下限 + 面积上限取交集，无漏检', () => {
  const result = filterHouses(FIXTURES, { priceMin: 3000, areaMax: 50 })
  assert.deepEqual(ids(result), [1, 3])
  assert.ok(result.every(h => h.price >= 3000 && h.area <= 50))
})
await test('分步设置与合并设置结果一致（交集语义）', () => {
  const merged = filterHouses(FIXTURES, { priceMin: 3000, areaMax: 50, layout: '两室一厅' })
  const step1 = filterHouses(FIXTURES, { priceMin: 3000 })
  const step2 = filterHouses(step1, { areaMax: 50 })
  const step3 = filterHouses(step2, { layout: '两室一厅' })
  assert.deepEqual(ids(step3), ids(merged))
})
await test('上下限交叉（下限 > 上限）结果为空且不抛异常', () => {
  assert.deepEqual(filterHouses(FIXTURES, { priceMin: 6000, priceMax: 2000 }), [])
  assert.deepEqual(filterHouses(FIXTURES, { areaMin: 100, areaMax: 40 }), [])
})
await test('不存在的户型结果为空；存在的户型全部匹配', () => {
  assert.deepEqual(filterHouses(FIXTURES, { layout: '五室三厅' }), [])
  assert.deepEqual(ids(filterHouses(FIXTURES, { layout: '两室一厅' })), [2, 3])
})

// ---------- B. 排序 ----------
group('B. 排序')
await test('priceAsc / priceDesc / timeDesc 方向正确', () => {
  assert.deepEqual(ids(sortHouses(FIXTURES, 'priceAsc')), [5, 1, 2, 3, 4])
  assert.deepEqual(ids(sortHouses(FIXTURES, 'priceDesc')), [4, 3, 1, 2, 5])
  assert.deepEqual(ids(sortHouses(FIXTURES, 'timeDesc')), [5, 4, 2, 3, 1])
})
await test('同价时按 id 升序决胜，结果稳定确定', () => {
  assert.deepEqual(ids(sortHouses(FIXTURES, 'priceAsc')).slice(1, 3), [1, 2])
  assert.deepEqual(ids(sortHouses(FIXTURES, 'priceDesc')).slice(2, 4), [1, 2])
})
await test('排序不修改原数组且保持集合不变', () => {
  const before = ids(FIXTURES)
  const sorted = sortHouses(FIXTURES, 'priceAsc')
  assert.deepEqual(ids(FIXTURES), before)
  assert.deepEqual([...ids(sorted)].sort((a, b) => a - b), [...before].sort((a, b) => a - b))
})
await test('筛选 + 排序组合：selectHouses 等价于先过滤再排序', () => {
  const combo = selectHouses(FIXTURES, { priceMin: 2000 }, 'priceAsc')
  assert.deepEqual(ids(combo), ids(sortHouses(filterHouses(FIXTURES, { priceMin: 2000 }), 'priceAsc')))
  assert.deepEqual(ids(combo), [1, 2, 3, 4])
})

// ---------- C. 拖拽移动原语 ----------
group('C. 顺序移动原语 moveItem')
await test('前移 / 后移结果正确且不修改原数组', () => {
  const list = [1, 2, 3, 4]
  assert.deepEqual(moveItem(list, 0, 2), [2, 3, 1, 4])
  assert.deepEqual(moveItem(list, 3, 0), [4, 1, 2, 3])
  assert.deepEqual(list, [1, 2, 3, 4])
})
await test('相同索引与非法索引为无操作', () => {
  assert.deepEqual(moveItem([1, 2, 3], 1, 1), [1, 2, 3])
  assert.deepEqual(moveItem([1, 2, 3], -1, 1), [1, 2, 3])
  assert.deepEqual(moveItem([1, 2, 3], 0, 3), [1, 2, 3])
  assert.deepEqual(moveItem([1, 2, 3], 0.5, 1), [1, 2, 3])
})

// ---------- D. store：筛选 / 排序链路 ----------
group('D. store 筛选排序链路')
await test('分次设置条件与一次合并设置，filteredHouses 完全一致', async () => {
  localStorage.clear()
  const s = await freshStore()
  s.setFilter({ priceMin: 3000 })
  s.setFilter({ areaMax: 80 })
  const stepwise = ids(s.filteredHouses)
  s.resetFilter()
  s.setFilter({ priceMin: 3000, areaMax: 80 })
  assert.deepEqual(ids(s.filteredHouses), stepwise)
  assert.ok(s.filteredHouses.every(h => h.price >= 3000 && h.area <= 80))
})
await test('筛选与排序联动：切换排序后仍满足筛选条件且顺序正确', async () => {
  const s = await freshStore()
  s.setFilter({ priceMin: 2500 })
  s.setSort('priceAsc')
  const prices = s.filteredHouses.map(h => h.price)
  assert.ok(s.filteredHouses.every(h => h.price >= 2500))
  assert.ok(prices.every((p, i) => i === 0 || prices[i - 1] <= p))
  s.setSort('priceDesc')
  const desc = s.filteredHouses.map(h => h.price)
  assert.ok(desc.every((p, i) => i === 0 || desc[i - 1] >= p))
})
await test('筛选 / 排序状态持久化，模拟刷新后完整恢复', async () => {
  localStorage.clear()
  const s = await freshStore()
  s.setFilter({ priceMin: 2500, layout: '两室一厅' })
  s.setSort('priceAsc')
  const s2 = await freshStore()
  assert.deepEqual(s2.filter, { priceMin: 2500, priceMax: null, areaMin: null, areaMax: null, layout: '两室一厅' })
  assert.equal(s2.sortType, 'priceAsc')
  assert.ok(s2.filteredHouses.every(h => h.price >= 2500 && h.layout === '两室一厅'))
  const prices = s2.filteredHouses.map(h => h.price)
  assert.ok(prices.every((p, i) => i === 0 || prices[i - 1] <= p))
})
await test('resetFilter 恢复默认并写入存储', async () => {
  const s = await freshStore()
  s.resetFilter()
  assert.deepEqual(s.filter, DEFAULT_FILTER)
  assert.deepEqual(JSON.parse(localStorage.getItem('rental_filter')), DEFAULT_FILTER)
})
await test('损坏的持久化数据回退默认值，不抛异常', async () => {
  localStorage.clear()
  localStorage.setItem('rental_filter', '{broken json')
  localStorage.setItem('rental_favorites', 'not-json')
  localStorage.setItem('rental_sort', '["bad"]')
  const s = await freshStore()
  assert.deepEqual(s.filter, DEFAULT_FILTER)
  assert.deepEqual(s.favoriteIds, [])
  assert.equal(s.sortType, 'timeDesc')
})
await test('非法排序类型被拒绝，状态不变', async () => {
  const s = await freshStore()
  s.setSort('priceAsc')
  s.setSort('bogus')
  assert.equal(s.sortType, 'priceAsc')
})

// ---------- E. store：收藏顺序与标记链路 ----------
group('E. 收藏顺序与收藏标记链路')
await test('收藏追加到末尾，取消后其余顺序不变，标记同步', async () => {
  localStorage.clear()
  const s = await freshStore()
  ;[3, 7, 12, 5].forEach(id => s.toggleFavorite(id))
  assert.deepEqual(s.favoriteIds, [3, 7, 12, 5])
  assert.ok(s.isFavorite(7) && !s.isFavorite(4))
  s.toggleFavorite(7)
  assert.deepEqual(s.favoriteIds, [3, 12, 5])
  assert.ok(!s.isFavorite(7))
})
await test('拖拽排序立即写入 localStorage，favoriteHouses 顺序同步', async () => {
  const s = await freshStore()
  s.reorderFavorites(0, 2)
  assert.deepEqual(s.favoriteIds, [12, 5, 3])
  assert.deepEqual(JSON.parse(localStorage.getItem('rental_favorites')), [12, 5, 3])
  assert.deepEqual(s.favoriteHouses.map(h => h.id), [12, 5, 3])
  assert.ok(s.favoriteHouses.every(h => s.isFavorite(h.id)))
})
await test('增删与拖拽混合操作后顺序稳定', async () => {
  const s = await freshStore()
  s.toggleFavorite(9)
  s.reorderFavorites(3, 0)
  s.toggleFavorite(5)
  s.reorderFavorites(0, 2)
  assert.deepEqual(s.favoriteIds, [12, 3, 9])
  assert.deepEqual(s.favoriteHouses.map(h => h.id), [12, 3, 9])
  assert.deepEqual(JSON.parse(localStorage.getItem('rental_favorites')), [12, 3, 9])
})
await test('非法拖拽索引不改变顺序', async () => {
  const s = await freshStore()
  s.reorderFavorites(-1, 1)
  s.reorderFavorites(0, 99)
  assert.deepEqual(s.favoriteIds, [12, 3, 9])
})
await test('模拟刷新后收藏顺序与标记完整恢复', async () => {
  const s2 = await freshStore()
  assert.deepEqual(s2.favoriteIds, [12, 3, 9])
  assert.deepEqual(s2.favoriteHouses.map(h => h.id), [12, 3, 9])
  assert.ok(s2.favoriteIds.every(id => s2.isFavorite(id)))
  assert.ok(!s2.isFavorite(1))
})

// ---------- F. 三链路一致性观察 ----------
group('F. 筛选结果 / 收藏顺序 / 收藏标记 一致性观察')
{
  localStorage.clear()
  const s = await freshStore()
  s.setFilter({ priceMin: 2000, areaMax: 90 })
  s.setSort('priceAsc')
  ;[2, 8, 4].forEach(id => s.toggleFavorite(id))
  s.reorderFavorites(0, 2)

  const s2 = await freshStore()
  const listIds = ids(s2.filteredHouses)
  const favOrder = [...s2.favoriteIds]
  const favMarks = Object.fromEntries(s2.houses.map(h => [h.id, s2.isFavorite(h.id)]))

  console.log(`  筛选条件: ${JSON.stringify(s2.filter)} 排序: ${s2.sortType}`)
  console.log(`  列表结果(${listIds.length}套): [${listIds.join(', ')}]`)
  console.log(`  收藏顺序: [${favOrder.join(', ')}]`)
  console.log(`  收藏标记: ${favOrder.map(id => `#${id}=${favMarks[id]}`).join(' ')}`)

  await test('刷新前后：列表结果、收藏顺序、收藏标记三者一致', () => {
    assert.deepEqual(s2.filter, s.filter)
    assert.equal(s2.sortType, s.sortType)
    assert.ok(s2.filteredHouses.every(h => h.price >= 2000 && h.area <= 90))
    assert.deepEqual(s2.favoriteIds, s.favoriteIds)
    assert.deepEqual(s2.favoriteHouses.map(h => h.id), s2.favoriteIds)
    assert.ok(s2.favoriteIds.every(id => s2.isFavorite(id)))
    const prices = s2.filteredHouses.map(h => h.price)
    assert.ok(prices.every((p, i) => i === 0 || prices[i - 1] <= p))
  })
}

// ---------- 汇总 ----------
console.log(`\n${'='.repeat(48)}`)
if (failures.length === 0) {
  console.log(`全部通过：${passed} 项验证 ✓`)
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项：`)
  for (const f of failures) console.log(`  ✗ ${f.name}`)
  process.exit(1)
}
