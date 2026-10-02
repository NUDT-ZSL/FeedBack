import { create } from 'zustand'

export type DocumentLevel = '步递' | '马递' | '急脚递'
export type SecurityLevel = '普通' | '机密' | '绝密'
export type DocumentStatus = '待分拣' | '已分拣' | '派送中' | '已送达' | '延误'
export type HorseStatus = '空闲' | '在役' | '疲惫' | '休息中'

export interface Document {
  id: string
  origin: string
  destination: string
  level: DocumentLevel
  securityLevel: SecurityLevel
  copies: number
  status: DocumentStatus
  receivedAt: Date
  sortedAt?: Date
  dispatchedAt?: Date
  deliveredAt?: Date
  deadline: Date
  currentStation: number
  totalStations: number
  assignedHorseId?: string
  assignedSoldierId?: string
  isUrgent: boolean
}

export interface Horse {
  id: string
  name: string
  health: number
  stamina: number
  maxStamina: number
  status: HorseStatus
  age: number
  maxLoad: number
  totalMileage: number
  currentStation: number
}

export interface Soldier {
  id: string
  name: string
  status: '空闲' | '在役' | '休息'
  assignments: number
}

export interface LogEntry {
  id: string
  timestamp: Date
  action: string
  documentId?: string
  horseId?: string
  level: 'info' | 'warning' | 'error'
}

export interface Dispatch {
  id: string
  documentId: string
  horseId: string
  soldierId: string
  startTime: Date
  estimatedArrival: Date
  status: '进行中' | '完成' | '延误'
}

interface StoreState {
  documents: Document[]
  horses: Horse[]
  soldiers: Soldier[]
  logs: LogEntry[]
  dispatches: Dispatch[]
  urgentCount: number
  isShaking: boolean
  selectedHorse: Horse | null
}

interface StoreActions {
  fetchDocuments: () => Promise<void>
  fetchHorses: () => Promise<void>
  fetchSoldiers: () => Promise<void>
  fetchLogs: () => Promise<void>
  addDocument: (doc: Document) => void
  updateDocument: (id: string, updates: Partial<Document>) => void
  generateDocuments: () => Promise<void>
  updateHorse: (id: string, updates: Partial<Horse>) => void
  assignHorse: (horseId: string, documentId: string) => Promise<void>
  returnHorse: (horseId: string) => Promise<void>
  createDispatch: (data: { documentId: string; horseId: string; soldierId: string }) => Promise<void>
  urgentDispatch: (documentId: string) => Promise<void>
  addLog: (entry: Partial<LogEntry>) => void
  triggerShake: () => void
  setSelectedHorse: (horse: Horse | null) => void
}

const API_BASE = '/api'

export const useStore = create<StoreState & StoreActions>((set, get) => ({
  documents: [],
  horses: [],
  soldiers: [],
  logs: [],
  dispatches: [],
  urgentCount: 3,
  isShaking: false,
  selectedHorse: null,

  fetchDocuments: async () => {
    try {
      const res = await fetch(`${API_BASE}/documents`)
      const data = await res.json()
      set({ documents: data })
    } catch (error) {
      console.error('获取公文失败:', error)
    }
  },

  fetchHorses: async () => {
    try {
      const res = await fetch(`${API_BASE}/horses`)
      const data = await res.json()
      set({ horses: data })
    } catch (error) {
      console.error('获取马匹失败:', error)
    }
  },

  fetchSoldiers: async () => {
    try {
      const res = await fetch(`${API_BASE}/soldiers`)
      const data = await res.json()
      set({ soldiers: data })
    } catch (error) {
      console.error('获取铺兵失败:', error)
    }
  },

  fetchLogs: async () => {
    try {
      const res = await fetch(`${API_BASE}/logs`)
      const data = await res.json()
      set({ logs: data })
    } catch (error) {
      console.error('获取日志失败:', error)
    }
  },

  addDocument: (doc: Document) => {
    set((state) => ({ documents: [...state.documents, doc] }))
  },

  updateDocument: (id: string, updates: Partial<Document>) => {
    set((state) => ({
      documents: state.documents.map((doc) =>
        doc.id === id ? { ...doc, ...updates } : doc
      ),
    }))
  },

  generateDocuments: async () => {
    try {
      const res = await fetch(`${API_BASE}/documents/generate`)
      const data = await res.json()
      set((state) => ({ documents: [...state.documents, ...data] }))
    } catch (error) {
      console.error('生成公文失败:', error)
    }
  },

  updateHorse: (id: string, updates: Partial<Horse>) => {
    set((state) => ({
      horses: state.horses.map((horse) =>
        horse.id === id ? { ...horse, ...updates } : horse
      ),
    }))
  },

  assignHorse: async (horseId: string, documentId: string) => {
    try {
      await fetch(`${API_BASE}/horses/${horseId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      })
      const { fetchHorses, fetchDocuments, addLog } = get()
      await Promise.all([fetchHorses(), fetchDocuments()])
      addLog({
        action: `马匹已分派至公文`,
        horseId,
        documentId,
        level: 'info',
      })
    } catch (error) {
      console.error('分派马匹失败:', error)
    }
  },

  returnHorse: async (horseId: string) => {
    try {
      await fetch(`${API_BASE}/horses/${horseId}/return`, {
        method: 'POST',
      })
      const { fetchHorses, addLog } = get()
      await fetchHorses()
      addLog({
        action: `马匹已归还`,
        horseId,
        level: 'info',
      })
    } catch (error) {
      console.error('归还马匹失败:', error)
    }
  },

  createDispatch: async (data: { documentId: string; horseId: string; soldierId: string }) => {
    try {
      const res = await fetch(`${API_BASE}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const dispatch = await res.json()
      set((state) => ({ dispatches: [...state.dispatches, dispatch] }))
      const { fetchDocuments, fetchHorses, fetchSoldiers, addLog } = get()
      await Promise.all([fetchDocuments(), fetchHorses(), fetchSoldiers()])
      addLog({
        action: `创建调度`,
        documentId: data.documentId,
        horseId: data.horseId,
        level: 'info',
      })
    } catch (error) {
      console.error('创建调度失败:', error)
    }
  },

  urgentDispatch: async (documentId: string) => {
    try {
      const res = await fetch(`${API_BASE}/dispatch/urgent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      })
      const data = await res.json()
      set({ urgentCount: data.remainingUrgentCount })
      const { fetchDocuments, addLog, triggerShake } = get()
      await fetchDocuments()
      addLog({
        action: `加急调度`,
        documentId,
        level: 'warning',
      })
      triggerShake()
    } catch (error) {
      console.error('加急调度失败:', error)
    }
  },

  addLog: (entry: Partial<LogEntry>) => {
    const newLog: LogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      action: entry.action || '',
      documentId: entry.documentId,
      horseId: entry.horseId,
      level: entry.level || 'info',
    }
    set((state) => ({ logs: [newLog, ...state.logs] }))
  },

  triggerShake: () => {
    set({ isShaking: true })
    setTimeout(() => {
      set({ isShaking: false })
    }, 300)
  },

  setSelectedHorse: (horse: Horse | null) => {
    set({ selectedHorse: horse })
  },
}))
