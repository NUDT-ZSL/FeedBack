export interface City {
  id: string
  name: string
  lat: number
  lng: number
  date: string
  photo: string
  description: string
  createdAt: number
}

export interface MapConfig {
  center: [number, number]
  zoom: number
  tileUrl: string
}

export interface SearchResult {
  name: string
  lat: number
  lng: number
  country?: string
}
