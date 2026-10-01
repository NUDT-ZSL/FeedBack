export interface Artwork {
  id: number
  name: string
  data: string
  gridSize: number
  createdAt: number
  likes: number
  liked: boolean
  author: string
}

export interface Comment {
  id: number
  artworkId: number
  author: string
  content: string
  createdAt: number
}

export type Page = 'canvas' | 'gallery' | 'detail'

export type GridSize = 16 | 32 | 64
