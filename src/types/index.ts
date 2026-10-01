export interface House {
  id: number
  title: string
  images: string[]
  location: string
  price: number
  area: number
  layout: string
  orientation: string
  isFirstRent: boolean
  petPolicy: string
  description: string
  publishTime: number
  landlord: {
    name: string
    avatar: string
    phone: string
  }
}

export interface FilterState {
  priceMin: number | null
  priceMax: number | null
  areaMin: number | null
  areaMax: number | null
  layout: string | null
}

export type SortType = 'priceAsc' | 'priceDesc' | 'timeDesc'

export interface Appointment {
  id: number
  houseId: number
  date: string
  time: string
  message: string
  createdAt: number
}

export interface ChatMessage {
  id: number
  houseId: number
  sender: 'user' | 'landlord'
  type: 'text' | 'image'
  content: string
  timestamp: number
}

export interface ChatData {
  houseId: number
  messages: ChatMessage[]
}
