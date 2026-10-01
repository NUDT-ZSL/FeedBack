import type { SearchResult } from '../types'

export const mockCityDatabase: SearchResult[] = [
  { name: '北京', lat: 39.9042, lng: 116.4074, country: '中国' },
  { name: '上海', lat: 31.2304, lng: 121.4737, country: '中国' },
  { name: '广州', lat: 23.1291, lng: 113.2644, country: '中国' },
  { name: '深圳', lat: 22.5431, lng: 114.0579, country: '中国' },
  { name: '成都', lat: 30.5728, lng: 104.0668, country: '中国' },
  { name: '杭州', lat: 30.2741, lng: 120.1551, country: '中国' },
  { name: '西安', lat: 34.3416, lng: 108.9398, country: '中国' },
  { name: '重庆', lat: 29.4316, lng: 106.9123, country: '中国' },
  { name: '南京', lat: 32.0603, lng: 118.7969, country: '中国' },
  { name: '武汉', lat: 30.5928, lng: 114.3055, country: '中国' },
  { name: '苏州', lat: 31.2990, lng: 120.5853, country: '中国' },
  { name: '厦门', lat: 24.4798, lng: 118.0894, country: '中国' },
  { name: '青岛', lat: 36.0671, lng: 120.3826, country: '中国' },
  { name: '三亚', lat: 18.2528, lng: 109.5119, country: '中国' },
  { name: '大理', lat: 25.6065, lng: 100.2679, country: '中国' },
  { name: '丽江', lat: 26.8721, lng: 100.2299, country: '中国' },
  { name: '拉萨', lat: 29.6520, lng: 91.1721, country: '中国' },
  { name: '乌鲁木齐', lat: 43.8256, lng: 87.6168, country: '中国' },
  { name: '哈尔滨', lat: 45.8038, lng: 126.5350, country: '中国' },
  { name: '香港', lat: 22.3193, lng: 114.1694, country: '中国' },
  { name: '东京', lat: 35.6762, lng: 139.6503, country: '日本' },
  { name: '大阪', lat: 34.6937, lng: 135.5023, country: '日本' },
  { name: '京都', lat: 35.0116, lng: 135.7681, country: '日本' },
  { name: '首尔', lat: 37.5665, lng: 126.9780, country: '韩国' },
  { name: '新加坡', lat: 1.3521, lng: 103.8198, country: '新加坡' },
  { name: '曼谷', lat: 13.7563, lng: 100.5018, country: '泰国' },
  { name: '巴黎', lat: 48.8566, lng: 2.3522, country: '法国' },
  { name: '伦敦', lat: 51.5074, lng: -0.1278, country: '英国' },
  { name: '纽约', lat: 40.7128, lng: -74.0060, country: '美国' },
  { name: '悉尼', lat: -33.8688, lng: 151.2093, country: '澳大利亚' }
]

export function searchCities(query: string): SearchResult[] {
  if (!query.trim()) return []
  const lowerQuery = query.toLowerCase()
  return mockCityDatabase
    .filter(city => 
      city.name.toLowerCase().includes(lowerQuery) ||
      (city.country && city.country.toLowerCase().includes(lowerQuery))
    )
    .slice(0, 10)
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
}

export function interpolateColor(progress: number): string {
  const startColor = { r: 255, g: 107, b: 107 }
  const endColor = { r: 78, g: 205, b: 196 }
  const r = Math.round(startColor.r + (endColor.r - startColor.r) * progress)
  const g = Math.round(startColor.g + (endColor.g - startColor.g) * progress)
  const b = Math.round(startColor.b + (endColor.b - startColor.b) * progress)
  return `rgb(${r}, ${g}, ${b})`
}

export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return function (this: any, ...args: Parameters<T>) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn.apply(this, args), delay)
  }
}
