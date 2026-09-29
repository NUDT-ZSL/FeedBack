import { defineStore } from 'pinia'
import type { DiaryEntry, EmotionType, Tag } from '@/types'
import { EMOTION_LABELS, TAG_COLORS } from '@/types'
import { analyzeEmotion } from '@/modules/analysis/emotionAnalyzer'

interface DiaryState {
  entries: DiaryEntry[]
  tags: Tag[]
  selectedTag: string | null
  searchQuery: string
}

const STORAGE_KEY = 'mindjournal_entries'
const TAGS_KEY = 'mindjournal_tags'

const DEFAULT_TAGS: Tag[] = [
  { name: '工作', color: TAG_COLORS[0] },
  { name: '家庭', color: TAG_COLORS[1] },
  { name: '健康', color: TAG_COLORS[2] },
  { name: '学习', color: TAG_COLORS[3] },
  { name: '情感', color: TAG_COLORS[4] }
]

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9)
}

function stripHtml(html: string): string {
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  return tmp.textContent || tmp.innerText || ''
}

export const useDiaryStore = defineStore('diary', {
  state: (): DiaryState => ({
    entries: [],
    tags: [],
    selectedTag: null,
    searchQuery: ''
  }),

  getters: {
    filteredEntries(state): DiaryEntry[] {
      let result = [...state.entries].sort((a, b) => b.createdAt - a.createdAt)

      if (state.selectedTag) {
        result = result.filter(entry => entry.tags.includes(state.selectedTag!))
      }

      if (state.searchQuery.trim()) {
        const query = state.searchQuery.toLowerCase()
        result = result.filter(entry =>
          stripHtml(entry.content).toLowerCase().includes(query)
        )
      }

      return result
    },

    getTagColor: (state) => (tagName: string): string => {
      const tag = state.tags.find(t => t.name === tagName)
      return tag?.color || TAG_COLORS[0]
    },

    thisWeekEmotionStats(state): Record<EmotionType, number> {
      const stats: Record<EmotionType, number> = {
        happy: 0,
        anxious: 0,
        angry: 0,
        sad: 0,
        peaceful: 0
      }

      const now = new Date()
      const startOfWeek = new Date(now)
      const day = startOfWeek.getDay()
      const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1)
      startOfWeek.setDate(diff)
      startOfWeek.setHours(0, 0, 0, 0)

      const weekEntries = state.entries.filter(
        entry => entry.createdAt >= startOfWeek.getTime()
      )

      weekEntries.forEach(entry => {
        stats[entry.emotion]++
      })

      return stats
    },

    hasTodayEntry(state): boolean {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      return state.entries.some(
        entry => new Date(entry.createdAt).toDateString() === today.toDateString()
      )
    }
  },

  actions: {
    loadFromStorage() {
      try {
        const savedEntries = localStorage.getItem(STORAGE_KEY)
        if (savedEntries) {
          this.entries = JSON.parse(savedEntries)
        }
        const savedTags = localStorage.getItem(TAGS_KEY)
        if (savedTags) {
          this.tags = JSON.parse(savedTags)
        } else {
          this.tags = [...DEFAULT_TAGS]
        }
      } catch (e) {
        console.error('Failed to load from storage:', e)
        this.tags = [...DEFAULT_TAGS]
      }
    },

    saveToStorage() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries))
        localStorage.setItem(TAGS_KEY, JSON.stringify(this.tags))
      } catch (e) {
        console.error('Failed to save to storage:', e)
      }
    },

    analyzeEmotion(content: string): { emotion: EmotionType; tips: string[] } {
      return analyzeEmotion(content)
    },

    addEntry(content: string, selectedTags: string[]): { entry: DiaryEntry; emotionLabel: string; tips: string[] } {
      const analysis = this.analyzeEmotion(content)
      const entry: DiaryEntry = {
        id: generateId(),
        content,
        emotion: analysis.emotion,
        tags: selectedTags,
        createdAt: Date.now()
      }
      this.entries.unshift(entry)
      this.saveToStorage()
      return {
        entry,
        emotionLabel: EMOTION_LABELS[analysis.emotion],
        tips: analysis.tips
      }
    },

    deleteEntry(id: string) {
      const index = this.entries.findIndex(e => e.id === id)
      if (index !== -1) {
        this.entries.splice(index, 1)
        this.saveToStorage()
      }
    },

    addTag(name: string) {
      name = name.trim()
      if (!name || this.tags.some(t => t.name === name)) return

      const usedColors = this.tags.map(t => t.color)
      const availableColor = TAG_COLORS.find(c => !usedColors.includes(c)) || TAG_COLORS[0]

      this.tags.push({ name, color: availableColor })
      this.saveToStorage()
    },

    deleteTag(name: string) {
      const index = this.tags.findIndex(t => t.name === name)
      if (index !== -1) {
        this.tags.splice(index, 1)
        this.entries.forEach(entry => {
          const tagIdx = entry.tags.indexOf(name)
          if (tagIdx !== -1) entry.tags.splice(tagIdx, 1)
        })
        if (this.selectedTag === name) this.selectedTag = null
        this.saveToStorage()
      }
    },

    setSelectedTag(tag: string | null) {
      this.selectedTag = tag
    },

    setSearchQuery(query: string) {
      this.searchQuery = query
    }
  }
})
