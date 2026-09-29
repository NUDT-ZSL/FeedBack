import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, type Ref } from 'vue'
import {
  computePositions,
  findStartIndex,
  findEndIndex,
  totalHeightOf,
  type ItemPosition
} from './virtualListMath'

export interface UseDynamicVirtualListOptions {
  /** 未测量项的预估高度 */
  estimatedHeight: number
  /** 项间距 */
  gap?: number
  /** 视口上下多渲染的项数 */
  overscan?: number
  containerHeight: Ref<number>
  scrollerRef: Ref<HTMLElement | null>
}

export interface VisibleItem<T> {
  item: T
  index: number
  key: string
}

/**
 * 动态高度虚拟列表：
 * - 已渲染项通过 ResizeObserver 实测高度并缓存，位置按累计偏移计算；
 * - 列表内容变化（过滤/删除/新增）时，以视口顶部第一项为锚点恢复滚动位置，
 *   不会跳回顶部。
 */
export function useDynamicVirtualList<T>(
  items: Ref<T[]>,
  getKey: (item: T) => string,
  options: UseDynamicVirtualListOptions
) {
  const estimatedHeight = options.estimatedHeight
  const gap = options.gap ?? 0
  const overscan = options.overscan ?? 5
  const containerHeight = options.containerHeight
  const scrollerRef = options.scrollerRef

  const scrollTop = ref(0)
  const measuredHeights = new Map<string, number>()
  const measureVersion = ref(0)

  const positions = computed<ItemPosition[]>(() => {
    measureVersion.value
    const heights = items.value.map(item => measuredHeights.get(getKey(item)) ?? estimatedHeight)
    return computePositions(heights, gap)
  })

  const totalHeight = computed(() => totalHeightOf(positions.value))

  const startIndex = computed(() =>
    Math.max(0, findStartIndex(positions.value, scrollTop.value) - overscan)
  )

  const endIndex = computed(() =>
    Math.min(
      items.value.length,
      findEndIndex(positions.value, scrollTop.value + containerHeight.value) + 1 + overscan
    )
  )

  const visibleItems = computed<VisibleItem<T>[]>(() =>
    items.value.slice(startIndex.value, endIndex.value).map((item, i) => ({
      item,
      index: startIndex.value + i,
      key: getKey(item)
    }))
  )

  const offsetY = computed(() => positions.value[startIndex.value]?.top ?? 0)

  function updateItemSize(key: string, height: number) {
    if (height <= 0) return
    const prev = measuredHeights.get(key)
    if (prev === undefined || Math.abs(prev - height) > 1) {
      measuredHeights.set(key, height)
      measureVersion.value++
    }
  }

  // ---- 尺寸观测 ----
  const observed = new Map<Element, string>()
  let resizeObserver: ResizeObserver | null = null

  function ensureObserver() {
    if (resizeObserver || typeof ResizeObserver === 'undefined') return
    resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const key = observed.get(entry.target)
        if (key) {
          updateItemSize(key, (entry.target as HTMLElement).offsetHeight)
        }
      }
    })
  }

  function observeItem(el: Element, key: string) {
    ensureObserver()
    observed.set(el, key)
    resizeObserver?.observe(el)
    updateItemSize(key, (el as HTMLElement).offsetHeight)
  }

  function unobserveItem(el: Element) {
    observed.delete(el)
    resizeObserver?.unobserve(el)
  }

  // ---- 锚点：视口顶部命中的项及其相对偏移 ----
  const anchorKey = ref<string | null>(null)
  const anchorIndex = ref(0)
  const anchorOffset = ref(0)

  function captureAnchor() {
    const list = items.value
    if (list.length === 0) {
      anchorKey.value = null
      anchorIndex.value = 0
      anchorOffset.value = 0
      return
    }
    const idx = Math.min(findStartIndex(positions.value, scrollTop.value), list.length - 1)
    anchorKey.value = getKey(list[idx])
    anchorIndex.value = idx
    anchorOffset.value = scrollTop.value - (positions.value[idx]?.top ?? 0)
  }

  function handleScroll(e: Event) {
    scrollTop.value = (e.target as HTMLElement).scrollTop
    captureAnchor()
  }

  // 列表内容变化后恢复锚点位置，保持视口稳定
  watch(items, async () => {
    await nextTick()
    const scroller = scrollerRef.value
    if (!scroller) return

    const key = anchorKey.value
    if (key) {
      const newIndex = items.value.findIndex(item => getKey(item) === key)
      if (newIndex !== -1) {
        const target = (positions.value[newIndex]?.top ?? 0) + anchorOffset.value
        scroller.scrollTop = Math.max(0, target)
      } else {
        // 锚点项已被移除：退化为按原索引位置定位，避免跳回顶部
        const fallback = Math.min(anchorIndex.value, Math.max(items.value.length - 1, 0))
        scroller.scrollTop = positions.value[fallback]?.top ?? 0
      }
    }

    scrollTop.value = scroller.scrollTop
    captureAnchor()
  }, { flush: 'post' })

  onMounted(() => {
    captureAnchor()
  })

  onBeforeUnmount(() => {
    resizeObserver?.disconnect()
    observed.clear()
  })

  return {
    scrollTop,
    visibleItems,
    totalHeight,
    offsetY,
    handleScroll,
    observeItem,
    unobserveItem,
    captureAnchor
  }
}
