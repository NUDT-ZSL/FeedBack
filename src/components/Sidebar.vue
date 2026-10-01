<template>
  <aside
    class="sidebar"
    :class="{ 'sidebar--mobile': isMobile, 'sidebar--open': isOpen }"
  >
    <div class="sidebar-header">
      <div class="brand">
        <div class="brand-icon">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
          </svg>
        </div>
        <div class="brand-text">
          <h1>旅行足迹</h1>
          <p>{{ cityCount }} 个目的地</p>
        </div>
      </div>
      <button v-if="isMobile" class="toggle-btn" @click="store.toggleSidebar">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
    </div>

    <div class="search-section">
      <div class="search-input-wrapper">
        <svg class="search-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          class="search-input"
          placeholder="搜索城市..."
          @input="handleSearch"
          @focus="showResults = true"
        />
      </div>

      <Transition name="fade">
        <div v-if="showResults && searchResults.length > 0" class="search-results">
          <div
            v-for="city in searchResults"
            :key="city.name"
            class="search-result-item"
            @click="handleSelectCity(city)"
          >
            <span class="city-name">{{ city.name }}</span>
            <span v-if="city.country" class="city-country">{{ city.country }}</span>
          </div>
        </div>
      </Transition>
    </div>

    <div class="city-list-wrapper">
      <div class="city-list-header">
        <span>我的旅程</span>
        <span class="city-count">{{ cityCount }}</span>
      </div>

      <div class="city-list" v-if="sortedCities.length > 0">
        <TransitionGroup name="city-list">
          <CityCard
            v-for="city in sortedCities"
            :key="city.id"
            :city="city"
            @select="handleCitySelect"
          />
        </TransitionGroup>
      </div>

      <div v-else class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
        <p>还没有添加任何城市</p>
        <p class="hint">在上方搜索框搜索并开始你的旅程</p>
      </div>
    </div>

    <div class="sidebar-footer">
      <button class="action-btn export-btn" @click="store.toggleExportMode">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
        </svg>
        导出分享图
      </button>
    </div>

    <div v-if="isMobile && isOpen" class="sidebar-overlay" @click="store.toggleSidebar"></div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import CityCard from './CityCard.vue'
import { useTravelStore } from '../store/travelStore'
import { searchCities, debounce } from '../utils/mapUtils'
import type { SearchResult, City } from '../types'

const emit = defineEmits<{
  (e: 'add-city', city: SearchResult): void
  (e: 'select-city', city: City): void
}>()

const store = useTravelStore()
const searchQuery = ref('')
const searchResults = ref<SearchResult[]>([])
const showResults = ref(false)
const isMobile = ref(false)

const sortedCities = computed(() => store.sortedCities)
const cityCount = computed(() => store.cities.length)
const isOpen = computed(() => store.isSidebarOpen)

const debouncedSearch = debounce((query: string) => {
  searchResults.value = searchCities(query)
  showResults.value = searchResults.value.length > 0
}, 200)

function handleSearch() {
  showResults.value = true
  debouncedSearch(searchQuery.value)
}

function handleSelectCity(city: SearchResult) {
  searchQuery.value = ''
  searchResults.value = []
  showResults.value = false
  emit('add-city', city)
}

function handleCitySelect(city: City) {
  emit('select-city', city)
  if (isMobile.value) {
    store.toggleSidebar()
  }
}

function handleClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.search-section')) {
    showResults.value = false
  }
}

function checkMobile() {
  isMobile.value = window.innerWidth < 768
  if (isMobile.value) {
    store.isSidebarOpen = false
  }
}

onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
  document.addEventListener('click', handleClickOutside)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', checkMobile)
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.sidebar {
  width: 320px;
  height: 100vh;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #e8e8e8;
  flex-shrink: 0;
  transition: transform 0.3s ease;
}

.sidebar--mobile {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 100;
  transform: translateX(-100%);
  box-shadow: 2px 0 12px rgba(0, 0, 0, 0.1);
}

.sidebar--mobile.sidebar--open {
  transform: translateX(0);
}

.sidebar-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: -1;
}

.sidebar-header {
  padding: 20px;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-icon {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, #ff6b6b, #4ecdc4);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.brand-text h1 {
  margin: 0;
  font-size: 18px;
  color: #2c3e50;
  font-weight: 600;
}

.brand-text p {
  margin: 2px 0 0;
  font-size: 12px;
  color: #95a5a6;
}

.toggle-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: #95a5a6;
  padding: 4px;
}

.search-section {
  padding: 16px 20px;
  position: relative;
}

.search-input-wrapper {
  position: relative;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: #95a5a6;
}

.search-input {
  width: 100%;
  padding: 10px 12px 10px 38px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  font-size: 14px;
  transition: all 0.2s;
  box-sizing: border-box;
}

.search-input:focus {
  outline: none;
  border-color: #ff6b6b;
  box-shadow: 0 0 0 3px rgba(255, 107, 107, 0.1);
}

.search-results {
  position: absolute;
  top: calc(100% - 8px);
  left: 20px;
  right: 20px;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  z-index: 10;
  max-height: 240px;
  overflow-y: auto;
}

.search-result-item {
  padding: 12px 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: background 0.15s;
}

.search-result-item:hover {
  background: #f8f9fa;
}

.search-result-item .city-name {
  font-size: 14px;
  color: #2c3e50;
  font-weight: 500;
}

.search-result-item .city-country {
  font-size: 12px;
  color: #95a5a6;
}

.city-list-wrapper {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.city-list-header {
  padding: 12px 20px;
  font-size: 13px;
  font-weight: 600;
  color: #7f8c8d;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.city-count {
  background: #f0f0f0;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
}

.city-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 20px 12px;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
  color: #95a5a6;
}

.empty-state svg {
  opacity: 0.4;
  margin-bottom: 16px;
}

.empty-state p {
  margin: 4px 0;
  font-size: 14px;
}

.empty-state .hint {
  font-size: 12px;
  opacity: 0.7;
}

.sidebar-footer {
  padding: 16px 20px;
  border-top: 1px solid #f0f0f0;
}

.action-btn {
  width: 100%;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  position: relative;
  overflow: hidden;
}

.export-btn {
  background: #ff6b6b;
  color: white;
}

.export-btn:hover {
  background: #e55a5a;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(255, 107, 107, 0.3);
}

.action-btn::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.3);
  transform: translate(-50%, -50%);
  transition: width 0.2s, height 0.2s;
}

.action-btn:active::after {
  width: 200px;
  height: 200px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.city-list-enter-active {
  animation: city-in 0.5s ease-out;
}

.city-list-leave-active {
  animation: city-out 0.3s ease-in;
}

@keyframes city-in {
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes city-out {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(20px);
  }
}

.city-list-move {
  transition: transform 0.3s ease;
}
</style>
