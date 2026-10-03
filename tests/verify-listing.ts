import { createPinia, setActivePinia } from 'pinia'
import {
  LISTING_STORAGE_KEY,
  LEGACY_FAVORITES_STORAGE_KEY,
  applyFilter,
  applySort,
  createDefaultFilter,
  createDefaultListingState,
  matchesFilter,
  moveFavoriteId,
  normalizeFavoriteIds,
  normalizeFilter,
  normalizeSortType,
  parseListingState,
  queryHouses,
  resolveFavoriteHouses,
  serializeListingState,
  toggleFavoriteId
} from '../src/stores/listingState.ts'
import { generateMockHouses } from '../src/data/mockHouses.ts'
import { useHouseStore } from '../src/stores/house.ts'
import type { House, FilterState, SortType } from '../src/types/index.ts'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    failures.push(name)
    console.log(`  ✗ ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`)
  }
}

function sameIds(a: readonly House[], b: readonly House[]): boolean {
  return a.length === b.length && a.every((h, i) => h.id === b[i].id)
}

function makeHouse(id: number, price: number, area: number, layout: string, publishTime: number): House {
  return {
    id,
    title: `房源${id}`,
    images: ['x.png'],
    location: '朝阳区 望京',
    price,
    area,
    layout,
    orientation: '朝南',
    isFirstRent: false,
    petPolicy: '允许养宠物',
    description: '',
    publishTime,
    landlord: { name: '王先生', avatar: '', phone: '123' }
  }
}

const fixtures: House[] = [
  makeHouse(1, 2500, 45, '一室一厅', 100),
  makeHouse(2, 3200, 60, '两室一厅', 300),
  makeHouse(3, 4800, 80, '三室一厅', 200),
  makeHouse(4, 6500, 100, '四室两厅', 400),
  makeHouse(5, 3200, 55, '两室一厅', 500)
]

function createMemoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    }
  }
}

async function createFreshStore(storage: ReturnType<typeof createMemoryStorage>) {
  ;(globalThis as Record<string, unknown>).localStorage = storage
  setActivePinia(createPinia())
  const store = useHouseStore()
  await store.fetchHouses()
  return store
}

console.log('\n[1] 筛选边界')
{
  const empty = createDefaultFilter()
  check('空筛选返回全部房源', applyFilter(fixtures, empty).length === fixtures.length)

  const onlyMin = normalizeFilter({ priceMin: 3000 })
  check('仅价格下限：结果全部 >= 下限', applyFilter(fixtures, onlyMin).every(h => h.price >= 3000))
  check('仅价格下限：命中数量正确', applyFilter(fixtures, onlyMin).length === 4)

  const onlyMax = normalizeFilter({ areaMax: 60 })
  check('仅面积上限：结果全部 <= 上限', applyFilter(fixtures, onlyMax).every(h => h.area <= 60))
  check('仅面积上限：命中数量正确', applyFilter(fixtures, onlyMax).length === 3)

  const combined = normalizeFilter({ priceMin: 3000, areaMax: 70 })
  const combinedResult = applyFilter(fixtures, combined)
  check(
    '价格下限+面积上限叠加：无越界房源',
    combinedResult.every(h => h.price >= 3000 && h.area <= 70),
    combinedResult.map(h => h.id)
  )
  check('叠加结果恰好是同时满足两项的房源', combinedResult.map(h => h.id).join() === '2,5')

  const stepwise = normalizeFilter({ ...normalizeFilter({ priceMin: 3000 }), areaMax: 70 })
  const atOnce = normalizeFilter({ priceMin: 3000, areaMax: 70 })
  check('分开设置与合并设置归一化结果一致', JSON.stringify(stepwise) === JSON.stringify(atOnce))
  check(
    '分开设置与合并设置列表结果一致',
    sameIds(queryHouses(fixtures, stepwise, 'timeDesc'), queryHouses(fixtures, atOnce, 'timeDesc'))
  )

  const reversed = normalizeFilter({ areaMax: 70, priceMin: 3000 } as FilterState)
  check(
    '条件设置顺序不影响结果',
    sameIds(queryHouses(fixtures, reversed, 'timeDesc'), queryHouses(fixtures, atOnce, 'timeDesc'))
  )

  const crossed = normalizeFilter({ priceMin: 5000, priceMax: 3000 })
  check('上下限交叉被归一化为有效区间', crossed.priceMin === 3000 && crossed.priceMax === 5000)
  check(
    '交叉归一化后结果落在区间内',
    applyFilter(fixtures, crossed).every(h => h.price >= 3000 && h.price <= 5000)
  )
  const crossedArea = normalizeFilter({ areaMin: 90, areaMax: 50 })
  check('面积上下限交叉同样被归一化', crossedArea.areaMin === 50 && crossedArea.areaMax === 90)

  check('不存在的户型返回空列表', applyFilter(fixtures, normalizeFilter({ layout: '八室十厅' })).length === 0)

  const dirty = normalizeFilter({
    priceMin: Number.NaN,
    priceMax: 'abc' as unknown as number,
    areaMin: -10,
    areaMax: Infinity,
    layout: '  ' 
  })
  check('NaN/非法字符串/负数/Infinity/空白户型均归一化为空条件', JSON.stringify(dirty) === JSON.stringify(createDefaultFilter()))

  check('字符串数字边界被接受', normalizeFilter({ priceMin: '3000' as unknown as number }).priceMin === 3000)
  check('null 与空串视为无限制', normalizeFilter({ priceMin: null, layout: '' }).layout === null)
}

console.log('\n[2] 排序')
{
  const asc = applySort(fixtures, 'priceAsc')
  check('价格升序单调不减', asc.every((h, i) => i === 0 || asc[i - 1].price <= h.price))
  check('同价按 id 稳定次序', asc[1].id === 2 && asc[2].id === 5)

  const desc = applySort(fixtures, 'priceDesc')
  check('价格降序单调不增', desc.every((h, i) => i === 0 || desc[i - 1].price >= h.price))

  const time = applySort(fixtures, 'timeDesc')
  check('最新发布按时间倒序', time.map(h => h.id).join() === '5,4,2,3,1')

  const before = fixtures.map(h => h.id).join()
  applySort(fixtures, 'priceAsc')
  check('排序不修改原数组', fixtures.map(h => h.id).join() === before)

  const combo = queryHouses(fixtures, { priceMin: 3000 }, 'priceAsc')
  check(
    '筛选+排序组合：子集且有序',
    combo.every(h => h.price >= 3000) && combo.every((h, i) => i === 0 || combo[i - 1].price <= h.price)
  )

  check('非法排序值回退为最新发布', normalizeSortType('bogus') === 'timeDesc')
}

console.log('\n[3] 收藏顺序')
{
  let ids: number[] = []
  ids = toggleFavoriteId(ids, 5)
  ids = toggleFavoriteId(ids, 2)
  ids = toggleFavoriteId(ids, 8)
  check('连续收藏按添加顺序排列', ids.join() === '5,2,8')

  ids = toggleFavoriteId(ids, 2)
  check('取消中间收藏后其余相对顺序不变', ids.join() === '5,8')

  check('向前移动 [1,2,3,4] (0->2)', moveFavoriteId([1, 2, 3, 4], 0, 2).join() === '2,3,1,4')
  check('向后移动 [1,2,3,4] (3->0)', moveFavoriteId([1, 2, 3, 4], 3, 0).join() === '4,1,2,3')
  check('from 越界时顺序不变', moveFavoriteId([1, 2, 3], 9, 0).join() === '1,2,3')
  check('to 越界时收敛到末尾', moveFavoriteId([1, 2, 3], 0, 99).join() === '2,3,1')
  check('to 为负时收敛到开头', moveFavoriteId([1, 2, 3], 2, -5).join() === '3,1,2')
  check('空列表拖拽安全返回', moveFavoriteId([], 0, 0).join() === '')

  let mixed: number[] = []
  mixed = toggleFavoriteId(mixed, 3)
  mixed = toggleFavoriteId(mixed, 7)
  mixed = toggleFavoriteId(mixed, 1)
  mixed = toggleFavoriteId(mixed, 9)
  mixed = moveFavoriteId(mixed, 0, 3)
  mixed = toggleFavoriteId(mixed, 7)
  mixed = moveFavoriteId(mixed, 2, 0)
  mixed = toggleFavoriteId(mixed, 12)
  mixed = moveFavoriteId(mixed, 3, 1)
  check('增删+拖拽混合后顺序确定', mixed.join() === '3,12,1,9', mixed)

  const resolved = resolveFavoriteHouses(fixtures, [4, 1, 99])
  check('收藏夹按 favoriteIds 顺序解析并跳过失效 id', resolved.map(h => h.id).join() === '4,1')

  check('收藏 id 归一化去重并剔除非法值', normalizeFavoriteIds([4, '9', 4, 'x', -1, 0, 2.5]).join() === '4,9')
}

console.log('\n[4] 持久化往返')
{
  const state = {
    filter: normalizeFilter({ priceMin: 3000, areaMax: 70, layout: '两室一厅' }),
    sortType: 'priceAsc' as SortType,
    favoriteIds: [9, 12, 1]
  }
  const restored = parseListingState(serializeListingState(state))
  check('序列化->解析后状态完全一致', JSON.stringify(restored) === JSON.stringify(state))
  check(
    '恢复后的列表推导结果一致',
    sameIds(queryHouses(fixtures, restored.filter, restored.sortType), queryHouses(fixtures, state.filter, state.sortType))
  )

  const corrupted = parseListingState('{not-json')
  check('损坏的持久化数据回退默认状态不抛错', JSON.stringify(corrupted) === JSON.stringify(createDefaultListingState()))

  const legacy = parseListingState(null, JSON.stringify([4, 9, 4]))
  check('无新数据时迁移旧版收藏', legacy.favoriteIds.join() === '4,9' && legacy.sortType === 'timeDesc')

  const freshWins = parseListingState(serializeListingState(state), JSON.stringify([1, 1, 1]))
  check('新数据存在时忽略旧版收藏', freshWins.favoriteIds.join() === '9,12,1')

  const crossedPersist = parseListingState(
    JSON.stringify({ version: 1, filter: { priceMin: 9000, priceMax: 100 }, sortType: '???', favoriteIds: 'nope' })
  )
  check(
    '持久化中的交叉边界/非法排序/非法收藏均被归一化',
    crossedPersist.filter.priceMin === 100 &&
      crossedPersist.filter.priceMax === 9000 &&
      crossedPersist.sortType === 'timeDesc' &&
      crossedPersist.favoriteIds.length === 0
  )
}

console.log('\n[5] 真实 mock 数据不变量')
{
  const houses = generateMockHouses()
  check('mock 房源数量 >= 20', houses.length >= 20)
  const combos: Array<Partial<FilterState>> = [
    { priceMin: 4000 },
    { areaMax: 60 },
    { priceMin: 3000, areaMax: 80 },
    { priceMin: 2000, priceMax: 6000, areaMin: 40, layout: houses[0].layout },
    { priceMin: 8000, priceMax: 2500 }
  ]
  let allHold = true
  for (const partial of combos) {
    const filter = normalizeFilter(partial)
    for (const h of applyFilter(houses, filter)) {
      if (!matchesFilter(h, filter)) allHold = false
    }
  }
  check('任意条件组合下结果均满足全部条件', allHold)
}

console.log('\n[6] store 级联一致性（模拟路由切换与刷新）')
{
  const storage = createMemoryStorage()

  let store = await createFreshStore(storage)
  store.setFilter({ priceMin: 3000 })
  store.setFilter({ areaMax: 70 })
  store.setSort('priceAsc')
  const mergedOk = store.filteredHouses.every(h => h.price >= 3000 && h.area <= 70)
  check('store 连续设置两个条件后无越界房源', mergedOk, store.filteredHouses.map(h => `${h.id}:${h.price}/${h.area}`))
  check('store 列表按价格升序', store.filteredHouses.every((h, i, arr) => i === 0 || arr[i - 1].price <= h.price))

  store.toggleFavorite(5)
  store.toggleFavorite(2)
  store.toggleFavorite(8)
  store.reorderFavorites(0, 2)
  store.toggleFavorite(8)
  store.toggleFavorite(11)
  store.reorderFavorites(2, 0)
  const favBefore = [...store.favoriteIds]
  check('混合操作后收藏顺序确定', favBefore.join() === '11,2,5', favBefore)
  check('收藏标记与收藏列表一致', store.isFavorite(2) && store.isFavorite(11) && !store.isFavorite(8))
  check('收藏夹解析顺序与 favoriteIds 一致', store.favoriteHouses.map(h => h.id).join() === favBefore.join())

  store = await createFreshStore(storage)
  check('刷新后筛选条件恢复', store.filter.priceMin === 3000 && store.filter.areaMax === 70)
  check('刷新后排序方式恢复', store.sortType === 'priceAsc')
  check('刷新后收藏顺序保持', store.favoriteIds.join() === favBefore.join(), store.favoriteIds)
  check('刷新后收藏夹顺序与标记一致', store.favoriteHouses.map(h => h.id).join() === favBefore.join() && store.isFavorite(5) && !store.isFavorite(8))
  check(
    '刷新后列表仍满足全部筛选条件',
    store.filteredHouses.every(h => h.price >= 3000 && h.area <= 70)
  )
  check(
    '刷新后筛选栏状态与列表推导同源',
    sameIds(store.filteredHouses, queryHouses(store.houses, store.filter, store.sortType))
  )

  store.resetFilter()
  store = await createFreshStore(storage)
  check('重置后刷新不再残留筛选条件', JSON.stringify(store.filter) === JSON.stringify(createDefaultFilter()))
}

console.log('\n[7] 旧版收藏数据迁移')
{
  const storage = createMemoryStorage()
  storage.setItem(LEGACY_FAVORITES_STORAGE_KEY, JSON.stringify([4, 9, 4, 'x', -1]))
  const store = await createFreshStore(storage)
  check('旧版收藏被迁移并归一化', store.favoriteIds.join() === '4,9', store.favoriteIds)
  check('旧版 key 已清除', storage.getItem(LEGACY_FAVORITES_STORAGE_KEY) === null)
  const persisted = parseListingState(storage.getItem(LISTING_STORAGE_KEY))
  check('迁移结果已写入新版持久化状态', persisted.favoriteIds.join() === '4,9')
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
if (failed > 0) {
  console.log(`失败用例: ${failures.join(' | ')}`)
  process.exit(1)
}
console.log('全部验证通过：筛选结果、收藏顺序、收藏标记三者一致。\n')
