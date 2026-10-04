import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { House, FilterState, SortType, Appointment, ChatMessage, ChatData } from '@/types'
import { generateMockHouses } from '../data/mockHouses.ts'
import {
  DEFAULT_FILTER,
  SORT_TYPES,
  normalizeFilter,
  selectHouses,
  moveItem
} from '../utils/listQuery.ts'

const FAVORITES_KEY = 'rental_favorites'
const APPOINTMENTS_KEY = 'rental_appointments'
const CHAT_KEY = 'rental_chats'
const FILTER_KEY = 'rental_filter'
const SORT_KEY = 'rental_sort'

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function parseFavoriteIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<number>()
  const ids: number[] = []
  for (const item of value) {
    if (typeof item === 'number' && Number.isFinite(item) && !seen.has(item)) {
      seen.add(item)
      ids.push(item)
    }
  }
  return ids
}

function parseSortType(value: unknown): SortType | null {
  return typeof value === 'string' && (SORT_TYPES as string[]).includes(value)
    ? (value as SortType)
    : null
}

export const useHouseStore = defineStore('house', () => {
  const houses = ref<House[]>([])
  const filter = ref<FilterState>({ ...DEFAULT_FILTER })
  const sortType = ref<SortType>('timeDesc')
  const favoriteIds = ref<number[]>([])
  const appointments = ref<Appointment[]>([])
  const chats = ref<ChatData[]>([])

  const filteredHouses = computed(() => selectHouses(houses.value, filter.value, sortType.value))

  const favoriteHouses = computed(() => {
    return favoriteIds.value
      .map(id => houses.value.find(h => h.id === id))
      .filter((h): h is House => h !== undefined)
  })

  function loadPersistedState() {
    favoriteIds.value = parseFavoriteIds(readJson(FAVORITES_KEY))
    const storedFilter = readJson(FILTER_KEY)
    if (storedFilter && typeof storedFilter === 'object') {
      filter.value = normalizeFilter(storedFilter as Partial<FilterState>)
    }
    const storedSort = parseSortType(readJson(SORT_KEY))
    if (storedSort) sortType.value = storedSort
    const appt = readJson(APPOINTMENTS_KEY)
    if (Array.isArray(appt)) appointments.value = appt
    const cht = readJson(CHAT_KEY)
    if (Array.isArray(cht)) chats.value = cht
  }

  function saveFavorites() {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteIds.value))
  }

  function saveFilter() {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filter.value))
  }

  function saveSort() {
    localStorage.setItem(SORT_KEY, JSON.stringify(sortType.value))
  }

  function saveAppointments() {
    localStorage.setItem(APPOINTMENTS_KEY, JSON.stringify(appointments.value))
  }

  function saveChats() {
    localStorage.setItem(CHAT_KEY, JSON.stringify(chats.value))
  }

  loadPersistedState()

  async function fetchHouses() {
    await new Promise(r => setTimeout(r, 300))
    houses.value = generateMockHouses()
  }

  function getHouseById(id: number): House | undefined {
    return houses.value.find(h => h.id === id)
  }

  function toggleFavorite(houseId: number) {
    const idx = favoriteIds.value.indexOf(houseId)
    if (idx > -1) {
      favoriteIds.value.splice(idx, 1)
    } else {
      favoriteIds.value.push(houseId)
    }
    saveFavorites()
  }

  function isFavorite(houseId: number): boolean {
    return favoriteIds.value.includes(houseId)
  }

  function reorderFavorites(fromIndex: number, toIndex: number) {
    const next = moveItem(favoriteIds.value, fromIndex, toIndex)
    if (next.join(',') !== favoriteIds.value.join(',')) {
      favoriteIds.value = next
      saveFavorites()
    }
  }

  function submitAppointment(data: Omit<Appointment, 'id' | 'createdAt'>): Appointment {
    const appt: Appointment = {
      ...data,
      id: Date.now(),
      createdAt: Date.now()
    }
    appointments.value.push(appt)
    saveAppointments()
    return appt
  }

  function getChatMessages(houseId: number): ChatMessage[] {
    const chat = chats.value.find(c => c.houseId === houseId)
    if (!chat) {
      const house = houses.value.find(h => h.id === houseId)
      const welcome: ChatMessage[] = [{
        id: 1,
        houseId,
        sender: 'landlord',
        type: 'text',
        content: `您好，我是房东${house?.landlord.name ?? ''}，请问您对这套房子有什么疑问吗？`,
        timestamp: Date.now() - 60000
      }]
      chats.value.push({ houseId, messages: welcome })
      return welcome
    }
    return chat.messages.sort((a, b) => a.timestamp - b.timestamp)
  }

  function sendChatMessage(houseId: number, type: 'text' | 'image', content: string): ChatMessage {
    let chat = chats.value.find(c => c.houseId === houseId)
    if (!chat) {
      chat = { houseId, messages: [] }
      chats.value.push(chat)
    }
    const msg: ChatMessage = {
      id: Date.now() + Math.random(),
      houseId,
      sender: 'user',
      type,
      content,
      timestamp: Date.now()
    }
    chat.messages.push(msg)
    saveChats()

    setTimeout(() => {
      if (chat) {
        const reply: ChatMessage = {
          id: Date.now() + Math.random() + 1,
          houseId,
          sender: 'landlord',
          type: 'text',
          content: '好的，我收到您的消息了，稍后回复您~',
          timestamp: Date.now()
        }
        chat.messages.push(reply)
        saveChats()
      }
    }, 1500)

    return msg
  }

  function setFilter(newFilter: Partial<FilterState>) {
    filter.value = normalizeFilter({ ...filter.value, ...newFilter })
    saveFilter()
  }

  function setSort(type: SortType) {
    if (!parseSortType(type)) return
    sortType.value = type
    saveSort()
  }

  function resetFilter() {
    filter.value = { ...DEFAULT_FILTER }
    saveFilter()
  }

  return {
    houses,
    filter,
    sortType,
    favoriteIds,
    appointments,
    chats,
    filteredHouses,
    favoriteHouses,
    fetchHouses,
    getHouseById,
    toggleFavorite,
    isFavorite,
    reorderFavorites,
    submitAppointment,
    getChatMessages,
    sendChatMessage,
    setFilter,
    setSort,
    resetFilter
  }
})
