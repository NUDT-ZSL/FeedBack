export type ColorMode = 'aqi' | 'temperature' | 'windSpeed'
export type DisplayMode = 'bubble' | 'heatmap'

export interface MonthlyData {
  month: string
  aqi: number
  pm25: number
  pm10: number
  temperature: number
  windSpeed: number
}

export interface CityData {
  id: string
  name: string
  lat: number
  lng: number
  monthlyData: MonthlyData[]
}

export interface EventMap {
  'city:select': CityData | null
  'city:hover': CityData | null
  'time:change': number
  'play:toggle': boolean
  'mode:color': ColorMode
  'mode:display': DisplayMode
  'filter:aqi': [number, number]
  'speed:change': number
  'details:show': CityData
}

type EventCallback<T> = (data: T) => void

class EventBus {
  private listeners: Map<keyof EventMap, Set<EventCallback<any>>> = new Map()

  on<K extends keyof EventMap>(event: K, callback: EventCallback<EventMap[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)
    return () => this.off(event, callback)
  }

  off<K extends keyof EventMap>(event: K, callback: EventCallback<EventMap[K]>): void {
    this.listeners.get(event)?.delete(callback)
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.listeners.get(event)?.forEach((cb) => cb(data))
  }
}

export const eventBus = new EventBus()
