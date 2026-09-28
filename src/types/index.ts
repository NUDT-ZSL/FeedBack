export type ToolType = 'pen' | 'rectangle' | 'circle' | 'select' | 'note'

export interface Point {
  x: number
  y: number
}

export interface DrawOperation {
  id: string
  type: 'pen' | 'rectangle' | 'circle'
  userId: string
  color: string
  lineWidth: number
  points?: Point[]
  startPoint?: Point
  endPoint?: Point
  timestamp: number
}

export interface StickyNoteData {
  id: string
  userId: string
  content: string
  x: number
  y: number
  color: string
  timestamp: number
}

export interface User {
  id: string
  name: string
  color: string
  roomId: string
}

export type WebSocketMessageType =
  | 'join'
  | 'leave'
  | 'draw'
  | 'undo'
  | 'redo'
  | 'note-add'
  | 'note-update'
  | 'note-delete'
  | 'user-list'
  | 'history'

export interface WebSocketMessage {
  type: WebSocketMessageType
  payload: any
}

export const PRESET_COLORS = [
  '#000000',
  '#E53935',
  '#FF9800',
  '#FDD835',
  '#43A047',
  '#1E88E5',
  '#8E24AA',
  '#EC407A'
] as const

export const NOTE_COLORS = [
  '#FFEB3B',
  '#8BC34A',
  '#03A9F4',
  '#E91E63',
  '#FF9800',
  '#9C27B0'
] as const

export const MAX_HISTORY_STEPS = 50
export const MAX_NOTES = 100
export const GRID_SIZE = 25
export const MIN_LINE_WIDTH = 2
export const MAX_LINE_WIDTH = 20
