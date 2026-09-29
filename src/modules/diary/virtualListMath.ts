/**
 * 动态高度虚拟列表的纯计算部分，独立可测。
 */

export interface ItemPosition {
  top: number
  height: number
  bottom: number
}

/** 由各项高度和间距计算累计偏移位置 */
export function computePositions(heights: number[], gap: number): ItemPosition[] {
  const positions: ItemPosition[] = []
  let top = 0
  for (const height of heights) {
    positions.push({ top, height, bottom: top + height })
    top += height + gap
  }
  return positions
}

/** 列表内容总高度（不含末尾间距） */
export function totalHeightOf(positions: ItemPosition[]): number {
  if (positions.length === 0) return 0
  return positions[positions.length - 1].bottom
}

/**
 * 二分查找第一个 bottom > scrollTop 的项，即视口顶部命中的项。
 * 列表为空时返回 0。
 */
export function findStartIndex(positions: ItemPosition[], scrollTop: number): number {
  if (positions.length === 0) return 0
  let lo = 0
  let hi = positions.length - 1
  let answer = positions.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (positions[mid].bottom > scrollTop) {
      answer = mid
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }
  return answer
}

/**
 * 查找最后一个 top < scrollBottom 的项（含），即视口底部命中的项。
 * 列表为空时返回 0。
 */
export function findEndIndex(positions: ItemPosition[], scrollBottom: number): number {
  if (positions.length === 0) return 0
  let lo = 0
  let hi = positions.length - 1
  let answer = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (positions[mid].top < scrollBottom) {
      answer = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return answer
}
