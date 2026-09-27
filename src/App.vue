<template>
  <div class="app-container" :class="{ 'export-mode': store.isExportMode }">
    <Sidebar
      @add-city="handleAddCity"
      @select-city="handleSelectCity"
    />

    <main class="main-content">
      <MapView
        ref="mapViewRef"
        @marker-click="handleMarkerClick"
      />
    </main>

    <AddCityModal
      :visible="showAddModal"
      :selected-city="selectedCityToAdd"
      @close="handleCloseAddModal"
      @added="handleCityAdded"
    />

    <CityInfoPopup
      :visible="showInfoPopup"
      :city="store.activeCity"
      @close="handleCloseInfoPopup"
    />

    <ExportPreview
      :visible="store.isExportMode"
      @close="store.toggleExportMode"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import Sidebar from './components/Sidebar.vue'
import MapView from './components/MapView.vue'
import AddCityModal from './components/AddCityModal.vue'
import CityInfoPopup from './components/CityInfoPopup.vue'
import ExportPreview from './components/ExportPreview.vue'
import { useTravelStore } from './store/travelStore'
import type { SearchResult, City } from './types'

const store = useTravelStore()
const mapViewRef = ref<InstanceType<typeof MapView> | null>(null)

const showAddModal = ref(false)
const selectedCityToAdd = ref<SearchResult | null>(null)

const showInfoPopup = computed(() => store.activeCity !== null)

function handleAddCity(city: SearchResult) {
  selectedCityToAdd.value = city
  showAddModal.value = true
}

function handleCloseAddModal() {
  showAddModal.value = false
  selectedCityToAdd.value = null
}

function handleCityAdded() {
  // 城市已添加，store 会自动更新
}

function handleSelectCity(city: City) {
  store.setActiveCity(city.id)
}

function handleMarkerClick(city: City) {
  store.setActiveCity(city.id)
}

function handleCloseInfoPopup() {
  store.setActiveCity(null)
}

watch(
  () => store.cities.length,
  () => {
    store.saveToStorage()
  }
)
</script>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background-color: #f0f4f8;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

html, body, #app {
  height: 100%;
  width: 100%;
  margin: 0;
  padding: 0;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #d0d5dd;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #98a2b3;
}
</style>

<style scoped>
.app-container {
  display: flex;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: #f0f4f8;
}

.main-content {
  flex: 1;
  position: relative;
  overflow: hidden;
}

@media (max-width: 767px) {
  .app-container {
    flex-direction: column;
  }
}
</style>
