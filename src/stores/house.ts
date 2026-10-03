import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { House, FilterState, SortType, Appointment, ChatMessage, ChatData } from '@/types'
import { generateMockHouses } from '../data/mockHouses.ts'
import {
  LISTING_STORAGE_KEY,
  LEGACY_FAVORITES_STORAGE_KEY,
  createDefaultFilter,
  moveFavoriteId,
  normalizeFilter,
  normalizeSortType,
  parseListingState,
  queryHouses,
  resolveFavoriteHouses,
  serializeListingState,
  toggleFavoriteId
} from './listingState.ts'

const APPOINTMENTS_KEY = 'rental_appointments'
const CHAT_KEY = 'rental_chats'

export const useHouseStore = defineStore('house', () => {
  const houses = ref<House[]>([])
  const filter = ref<FilterState>(createDefaultFilter())
  const sortType = ref<SortType>('timeDesc')
  const favoriteIds = ref<number[]>([])
  const appointments = ref<Appointment[]>([])
  const chats = ref<ChatData[]>([])

  const filteredHouses = computed(() => {
    return queryHouses(houses.value, filter.value, sortType.value)
  })

  const favoriteHouses = computed(() => {
    return resolveFavoriteHouses(houses.value, favoriteIds.value)
  })

  function loadFromStorage() {
    try {
      const listing = parseListingState(
        localStorage.getItem(LISTING_STORAGE_KEY),
        localStorage.getItem(LEGACY_FAVORITES_STORAGE_KEY)
      )
      filter.value = listing.filter
      sortType.value = listing.sortType
      favoriteIds.value = listing.favoriteIds
      if (localStorage.getItem(LEGACY_FAVORITES_STORAGE_KEY) !== null) {
        localStorage.removeItem(LEGACY_FAVORITES_STORAGE_KEY)
        persistListingState()
      }
      const appt = localStorage.getItem(APPOINTMENTS_KEY)
      if (appt) appointments.value = JSON.parse(appt)
      const cht = localStorage.getItem(CHAT_KEY)
      if (cht) chats.value = JSON.parse(cht)
    } catch (e) {
      console.error('Load storage error:', e)
    }
  }

  function persistListingState() {
    try {
      localStorage.setItem(
        LISTING_STORAGE_KEY,
        serializeListingState({
          filter: filter.value,
          sortType: sortType.value,
          favoriteIds: favoriteIds.value
        })
      )
    } catch (e) {
      console.error('Save listing state error:', e)
    }
  }

  function saveAppointments() {
    localStorage.setItem(APPOINTMENTS_KEY, JSON.stringify(appointments.value))
  }

  function saveChats() {
    localStorage.setItem(CHAT_KEY, JSON.stringify(chats.value))
  }

  async function fetchHouses() {
    await new Promise(r => setTimeout(r, 300))
    houses.value = generateMockHouses()
    loadFromStorage()
  }

  function getHouseById(id: number): House | undefined {
    return houses.value.find(h => h.id === id)
  }

  function toggleFavorite(houseId: number) {
    favoriteIds.value = toggleFavoriteId(favoriteIds.value, houseId)
    persistListingState()
  }

  function isFavorite(houseId: number): boolean {
    return favoriteIds.value.includes(houseId)
  }

  function reorderFavorites(fromIndex: number, toIndex: number) {
    favoriteIds.value = moveFavoriteId(favoriteIds.value, fromIndex, toIndex)
    persistListingState()
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
    persistListingState()
  }

  function setSort(type: SortType) {
    sortType.value = normalizeSortType(type)
    persistListingState()
  }

  function resetFilter() {
    filter.value = createDefaultFilter()
    persistListingState()
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
