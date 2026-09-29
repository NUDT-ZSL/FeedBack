import { describe, it, expect } from 'vitest'
import {
  computePositions,
  totalHeightOf,
  findStartIndex,
  findEndIndex
} from '../virtualListMath'

describe('virtualListMath（动态高度虚拟滚动）', () => {
  it('按高度与间距累计偏移', () => {
    const positions = computePositions([100, 300, 150], 16)
    expect(positions[0]).toEqual({ top: 0, height: 100, bottom: 100 })
    expect(positions[1]).toEqual({ top: 116, height: 300, bottom: 416 })
    expect(positions[2]).toEqual({ top: 432, height: 150, bottom: 582 })
    expect(totalHeightOf(positions)).toBe(582)
  })

  it('空列表返回零高度与安全下标', () => {
    const positions = computePositions([], 16)
    expect(totalHeightOf(positions)).toBe(0)
    expect(findStartIndex(positions, 100)).toBe(0)
    expect(findEndIndex(positions, 100)).toBe(0)
  })

  it('高低不一的列表中定位视口起始项', () => {
    // 模拟长短日记混排：高度差异很大
    const heights = [600, 80, 80, 500, 90, 700, 100]
    const gap = 16
    const positions = computePositions(heights, gap)

    expect(findStartIndex(positions, 0)).toBe(0)
    // scrollTop 落在第 1 项（top 616, bottom 696）内
    expect(findStartIndex(positions, 650)).toBe(1)
    // scrollTop 恰好等于第 1 项 top
    expect(findStartIndex(positions, 616)).toBe(1)
    // 越过所有内容时收敛到最后一项
    expect(findStartIndex(positions, 99999)).toBe(heights.length - 1)
  })

  it('定位视口结束项', () => {
    const heights = [100, 100, 100, 100]
    const positions = computePositions(heights, 10)
    // 视口底部 220：覆盖第 0 项(0-100)、第 1 项(110-210)、第 2 项 top=220 不算
    expect(findEndIndex(positions, 220)).toBe(1)
    expect(findEndIndex(positions, 221)).toBe(2)
    expect(findEndIndex(positions, 0)).toBe(0)
  })
})
