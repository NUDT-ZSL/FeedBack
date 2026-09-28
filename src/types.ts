export type EmotionType = 'happy' | 'anxious' | 'angry' | 'sad' | 'peaceful'

export interface DiaryEntry {
  id: string
  content: string
  emotion: EmotionType
  tags: string[]
  createdAt: number
}

export interface Tag {
  name: string
  color: string
}

export interface Reminder {
  id: string
  enabled: boolean
  hour: number
  minute: number
  targetEmotion: EmotionType | null
  message: string
}

export interface EmotionAnalysis {
  emotion: EmotionType
  tips: string[]
}

export const EMOTION_LABELS: Record<EmotionType, string> = {
  happy: '开心',
  anxious: '焦虑',
  angry: '愤怒',
  sad: '悲伤',
  peaceful: '平和'
}

export const EMOTION_COLORS: Record<EmotionType, string> = {
  happy: '#FFD93D',
  anxious: '#FF6B6B',
  angry: '#FF8C42',
  sad: '#6C9BCF',
  peaceful: '#95E1D3'
}

export const TAG_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#BB8FCE', '#85C1E9'
]
