import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { House, FilterState, SortType, Appointment, ChatMessage, ChatData } from '@/types'
import { generateMockHouses } from '@/data/mockHouses'

const FAVORITES_KEY = 'rental_favorites'
const APPOINTMENTS_KEY = 'rental_appointments'
const CHAT_KEY = 'rental_chats'

export const useHouseStore = defineStore('house', () => {
  const houses = ref<House[]>([])
  const filter = ref<FilterState>({
    priceMin: null,
    priceMax: null,
    areaMin: null,
    areaMax: null,
    layout: null
  })
  const sortType = ref<SortType>('timeDesc')
  const favoriteIds = ref<number[]>([])
  const appointments = ref<Appointment[]>([])
  const chats = ref<ChatData[]>([])

  const filteredHouses = computed(() => {
    let result = [...houses.value]

    if (filter.value.priceMin !== null) {
      result = result.filter(h => h.price >= filter.value.priceMin!)
    }
    if (filter.value.priceMax !== null) {
      result = result.filter(h => h.price <= filter.value.priceMax!)
    }
    if (filter.value.areaMin !== null) {
      result = result.filter(h => h.area >= filter.value.areaMin!)
    }
    if (filter.value.areaMax !== null) {
      result = result.filter(h => h.area <= filter.value.areaMax!)
    }
    if (filter.value.layout) {
      result = result.filter(h => h.layout === filter.value.layout)
    }

    switch (sortType.value) {
      case 'priceAsc':
        result.sort((a, b) => a.price - b.price)
        break
      case 'priceDesc':
        result.sort((a, b) => b.price - a.price)
        break
      case 'timeDesc':
      default:
        result.sort((a, b) => b.publishTime - a.publishTime)
        break
    }

    return result
  })

  const favoriteHouses = computed(() => {
    return favoriteIds.value
      .map(id => houses.value.find(h => h.id === id))
      .filter((h): h is House => h !== undefined)
  })

  function loadFromStorage() {
    try {
      const fav = localStorage.getItem(FAVORITES_KEY)
      if (fav) favoriteIds.value = JSON.parse(fav)
      const appt = localStorage.getItem(APPOINTMENTS_KEY)
      if (appt) appointments.value = JSON.parse(appt)
      const cht = localStorage.getItem(CHAT_KEY)
      if (cht) chats.value = JSON.parse(cht)
    } catch (e) {
      console.error('Load storage error:', e)
    }
  }

  function saveFavorites() {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteIds.value))
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
    const arr = [...favoriteIds.value]
    const [removed] = arr.splice(fromIndex, 1)
    arr.splice(toIndex, 0, removed)
    favoriteIds.value = arr
    saveFavorites()
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
    filter.value = { ...filter.value, ...newFilter }
  }

  function setSort(type: SortType) {
    sortType.value = type
  }

  function resetFilter() {
    filter.value = {
      priceMin: null,
      priceMax: null,
      areaMin: null,
      areaMax: null,
      layout: null
    }
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
