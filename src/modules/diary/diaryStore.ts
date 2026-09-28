import { defineStore } from 'pinia'
import type { DiaryEntry, EmotionType, Tag } from '@/types'
import { EMOTION_LABELS, TAG_COLORS } from '@/types'

interface EmotionDictionary {
  happy: string[]
  anxious: string[]
  angry: string[]
  sad: string[]
  peaceful: string[]
}

interface HealingTips {
  happy: string[]
  anxious: string[]
  angry: string[]
  sad: string[]
  peaceful: string[]
}

const EMOTION_DICTIONARY: EmotionDictionary = {
  happy: [
    '开心', '高兴', '快乐', '幸福', '愉悦', '喜悦', '欣喜', '兴奋', '满足', '感恩',
    '愉快', '欢乐', '欢笑', '甜蜜', '美好', '希望', '成功', '胜利', '热爱', '喜欢',
    '满意', '期待', '放松', '舒适', '安心', '顺利', '惊喜', '感动', '温暖', '阳光'
  ],
  anxious: [
    '焦虑', '紧张', '担心', '不安', '忧虑', '害怕', '恐惧', '压力', '烦躁', '忐忑',
    '纠结', '犹豫', '彷徨', '迷茫', '不安', '心慌', '心乱', '急躁', '着急', '忧心',
    '烦恼', '困扰', '困扰', '不安', '焦虑', '紧张', '烦躁', '不安', '焦躁', '急切'
  ],
  angry: [
    '愤怒', '生气', '恼火', '气愤', '暴燥', '不满', '怨恨', '痛恨', '愤怒', '暴怒',
    '怒火', '恼火', '气恼', '气愤', '愤怒', '不满', '反感', '厌恶', '恼恨', '愤慨',
    '暴躁', '发火', '愤怒', '愤怒', '愤怒', '愤怒', '愤怒', '愤怒', '愤怒', '愤怒'
  ],
  sad: [
    '悲伤', '难过', '伤心', '痛苦', '失落', '沮丧', '绝望', '孤独', '寂寞', '无奈',
    '心碎', '哭泣', '眼泪', '忧伤', '忧愁', '愁闷', '苦闷', '抑郁', '消沉', '低沉',
    '凄凉', '悲惨', '不幸', '失望', '绝望', '痛苦', '悲痛', '哀伤', '惆怅', '遗憾'
  ],
  peaceful: [
    '平静', '平和', '宁静', '安静', '安稳', '淡定', '从容', '坦然', '淡然', '安宁',
    '静谧', '安详', '闲适', '自在', '舒心', '清爽', '轻松', '惬意', '舒坦', '踏实',
    '安稳', '安心', '平和', '宁静', '平静', '祥和', '安稳', '安详', '平和', '平静'
  ]
}

const HEALING_TIPS: HealingTips = {
  happy: [
    '记录下这份美好，它将成为你未来的力量源泉 ✨',
    '试着把这份开心分享给身边的人，快乐会加倍！',
    '保持这份积极的心态，继续迎接美好的每一天！',
    '不妨做一件让自己更开心的小事来庆祝一下 🎉'
  ],
  anxious: [
    '深呼吸，试着把担忧写下来，你会发现很多担心其实不会发生 🌿',
    '建议做5分钟正念冥想，专注于当下的呼吸',
    '把让你焦虑的事情分解成小步骤，一次只做一件',
    '适当的运动可以有效缓解焦虑，试试散步或瑜伽'
  ],
  angry: [
    '先给自己10分钟冷静时间，情绪平复后再做决定 🕊️',
    '试着从对方的角度理解事情，也许会有不同的看法',
    '表达愤怒的方式有很多种，运动和写作都是健康的选择',
    '喝一杯温水，闭上眼睛，感受身体的放松'
  ],
  sad: [
    '允许自己悲伤，这是正常的情绪表达，不用强迫自己坚强 💙',
    '和信任的朋友或家人聊聊，倾诉可以减轻一半的痛苦',
    '做一件能让你稍微感到温暖的小事，比如喝杯热饮、看一部温馨的电影',
    '记住，黑夜总会过去，明天又是新的一天 ☀️'
  ],
  peaceful: [
    '享受这份难得的宁静，让身心得到充分的休息 🍃',
    '可以记录下让你感到平和的事物，以后需要时可以回顾',
    '这份平静是很好的状态，试着带着它去完成今天的事情',
    '冥想或阅读可以帮你延续这份美好的心境'
  ]
}

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
      const text = stripHtml(content).toLowerCase()
      const scores: Record<EmotionType, number> = {
        happy: 0,
        anxious: 0,
        angry: 0,
        sad: 0,
        peaceful: 0
      }

      const emotions: EmotionType[] = ['happy', 'anxious', 'angry', 'sad', 'peaceful']

      emotions.forEach(emotion => {
        EMOTION_DICTIONARY[emotion].forEach(keyword => {
          if (text.includes(keyword.toLowerCase())) {
            scores[emotion]++
          }
        })
      })

      let maxScore = 0
      let detectedEmotion: EmotionType = 'peaceful'

      emotions.forEach(emotion => {
        if (scores[emotion] > maxScore) {
          maxScore = scores[emotion]
          detectedEmotion = emotion
        }
      })

      const tips = HEALING_TIPS[detectedEmotion]
      const shuffledTips = [...tips].sort(() => Math.random() - 0.5).slice(0, 2)

      return {
        emotion: detectedEmotion,
        tips: shuffledTips
      }
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
