/**
 * 前端唯一状态入口：工序、材料、修复记录三个面板都从这里读取，
 * 数据来自后端共享的 WorkshopStore（/api/workshop）。
 * 写操作统一携带 baseVersion，冲突时保留痕迹并提示当前有效版本。
 */
import { create } from 'zustand'
import {
  type BookSnapshot,
  type CommitResult,
  type MaterialMovementView,
  type OperationRequest,
  type RepairRecordView,
} from '@/workshop/types'

const API_BASE = '/api/workshop'

interface BookSummary {
  id: string
  title: string
}

interface WorkshopState {
  books: BookSummary[]
  selectedBookId: string | null
  version: number
  snapshot: BookSnapshot | null
  records: RepairRecordView[]
  movements: MaterialMovementView[]
  lastResult: { text: string; tone: 'ok' | 'conflict' | 'error' } | null
  loading: boolean
  loadBooks: () => Promise<void>
  selectBook: (bookId: string) => Promise<void>
  refresh: () => Promise<void>
  submit: (
    payload: OperationRequest['payload'],
    options?: { opId?: string; baseVersion?: number },
  ) => Promise<CommitResult>
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  const body = await response.json()
  return body.data as T
}

export const useWorkshopStore = create<WorkshopState>((set, get) => ({
  books: [],
  selectedBookId: null,
  version: 0,
  snapshot: null,
  records: [],
  movements: [],
  lastResult: null,
  loading: false,

  loadBooks: async () => {
    const books = await getJson<BookSummary[]>(`${API_BASE}/books`)
    set({ books })
    if (books.length > 0 && !get().selectedBookId) {
      await get().selectBook(books[0].id)
    }
  },

  selectBook: async (bookId) => {
    set({ selectedBookId: bookId, lastResult: null })
    await get().refresh()
  },

  refresh: async () => {
    const { selectedBookId } = get()
    if (!selectedBookId) return
    set({ loading: true })
    try {
      const [snapshot, records, movements] = await Promise.all([
        getJson<BookSnapshot>(`${API_BASE}/books/${selectedBookId}/snapshot`),
        getJson<RepairRecordView[]>(`${API_BASE}/books/${selectedBookId}/records`),
        getJson<MaterialMovementView[]>(
          `${API_BASE}/materials/movements?bookId=${selectedBookId}`,
        ),
      ])
      set({ snapshot, records, movements, version: snapshot.version, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  submit: async (payload, options) => {
    const { selectedBookId, version } = get()
    if (!selectedBookId) throw new Error('no selected book')
    const operation: OperationRequest = {
      opId: options?.opId ?? globalThis.crypto.randomUUID(),
      bookId: selectedBookId,
      baseVersion: options?.baseVersion ?? version,
      payload,
    }
    const response = await fetch(`${API_BASE}/operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(operation),
    })
    const body = (await response.json()) as { data: CommitResult }
    const result = body.data
    if (result.status === 'conflict') {
      set({
        lastResult: {
          text: `操作冲突：该册书已被其他入口更新（你基于版本 ${
            operation.baseVersion
          }，当前版本 ${result.version}），冲突已留痕`,
          tone: 'conflict',
        },
      })
    } else if (result.status === 'rejected') {
      set({ lastResult: { text: `操作被拒绝：${result.reason}`, tone: 'error' } })
    } else if (result.status === 'duplicate') {
      set({ lastResult: { text: '操作已提交过（幂等），未重复生效', tone: 'ok' } })
    } else {
      set({ lastResult: { text: '操作已生效，所有面板已同步', tone: 'ok' } })
    }
    await get().refresh()
    return result
  },
}))
