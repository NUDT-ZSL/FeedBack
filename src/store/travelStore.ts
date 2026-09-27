import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { City, MapConfig } from '../types'
import { generateId } from '../utils/mapUtils'

export const useTravelStore = defineStore('travel', () => {
  const cities = ref<City[]>([])
  const activeCityId = ref<string | null>(null)
  const isExportMode = ref(false)
  const isSidebarOpen = ref(true)

  const mapConfig = ref<MapConfig>({
    center: [35.8617, 104.1954],
    zoom: 4,
    tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  })

  const sortedCities = computed(() => {
    return [...cities.value].sort((a, b) => a.createdAt - b.createdAt)
  })

  const activeCity = computed(() => {
    if (!activeCityId.value) return null
    return cities.value.find(c => c.id === activeCityId.value) || null
  })

  function addCity(data: Omit<City, 'id' | 'createdAt'>) {
    const newCity: City = {
      ...data,
      id: generateId(),
      createdAt: Date.now()
    }
    cities.value.push(newCity)
    return newCity
  }

  function removeCity(id: string) {
    const index = cities.value.findIndex(c => c.id === id)
    if (index !== -1) {
      cities.value.splice(index, 1)
      if (activeCityId.value === id) {
        activeCityId.value = null
      }
    }
  }

  function setActiveCity(id: string | null) {
    activeCityId.value = id
  }

  function setMapConfig(config: Partial<MapConfig>) {
    mapConfig.value = { ...mapConfig.value, ...config }
  }

  function toggleExportMode() {
    isExportMode.value = !isExportMode.value
  }

  function toggleSidebar() {
    isSidebarOpen.value = !isSidebarOpen.value
  }

  function loadFromStorage() {
    try {
      const saved = localStorage.getItem('travel-footprint-cities')
      if (saved) {
        cities.value = JSON.parse(saved)
      }
    } catch (e) {
      console.error('Failed to load cities from storage:', e)
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem('travel-footprint-cities', JSON.stringify(cities.value))
    } catch (e) {
      console.error('Failed to save cities to storage:', e)
    }
  }

  return {
    cities,
    sortedCities,
    activeCityId,
    activeCity,
    isExportMode,
    isSidebarOpen,
    mapConfig,
    addCity,
    removeCity,
    setActiveCity,
    setMapConfig,
    toggleExportMode,
    toggleSidebar,
    loadFromStorage,
    saveToStorage
  }
})
