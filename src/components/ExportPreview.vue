<template>
  <Teleport to="body">
    <Transition name="export">
      <div v-if="visible" class="export-overlay">
        <div class="export-container" ref="exportContainerRef">
          <div class="export-header">
            <h2>我的旅行足迹</h2>
            <p>共 {{ sortedCities.length }} 个目的地</p>
          </div>

          <div class="export-content" id="export-content">
            <div class="export-map-section">
              <div ref="exportMapRef" class="export-map"></div>
              <div class="export-map-overlay">
                <div class="trip-info">
                  <span class="trip-count">{{ sortedCities.length }}</span>
                  <span class="trip-label">城市</span>
                </div>
              </div>
            </div>

            <div v-if="sortedCities.length > 0" class="export-photos-section">
              <div
                v-for="(city, index) in displayCities"
                :key="city.id"
                class="export-photo-card"
              >
                <div class="photo-number">{{ index + 1 }}</div>
                <div class="photo-wrapper">
                  <img v-if="city.photo" :src="city.photo" :alt="city.name" />
                  <div v-else class="photo-placeholder">
                    <span>{{ city.name.charAt(0) }}</span>
                  </div>
                </div>
                <div class="photo-info">
                  <h4>{{ city.name }}</h4>
                  <span>{{ formatDate(city.date) }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="export-footer">
            <button class="btn btn-secondary" @click="handleClose">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
              取消
            </button>
            <button
              class="btn btn-primary"
              @click="handleExport"
              :disabled="isExporting"
            >
              <svg v-if="!isExporting" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
              </svg>
              <span v-if="isExporting">导出中...</span>
              <span v-else>导出 PNG (1280×720)</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import L from 'leaflet'
import html2canvas from 'html2canvas'
import { useTravelStore } from '../store/travelStore'
import { interpolateColor } from '../utils/mapUtils'
import type { City } from '../types'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const store = useTravelStore()
const exportContainerRef = ref<HTMLDivElement | null>(null)
const exportMapRef = ref<HTMLDivElement | null>(null)
const isExporting = ref(false)

let exportMap: L.Map | null = null
const exportMarkers: L.Marker[] = []

const sortedCities = computed(() => store.sortedCities)
const displayCities = computed(() => sortedCities.value.slice(0, 6))

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

function initExportMap() {
  if (!exportMapRef.value || sortedCities.value.length === 0) return

  if (exportMap) {
    exportMap.remove()
    exportMap = null
  }
  exportMarkers.length = 0

  const bounds = L.latLngBounds(sortedCities.value.map(c => [c.lat, c.lng]))
  const center = bounds.getCenter()
  const zoom = Math.min(10, Math.max(3, exportMapRef.value.clientWidth > 600 ? 5 : 4))

  exportMap = L.map(exportMapRef.value, {
    center: [center.lat, center.lng],
    zoom,
    zoomControl: false,
    attributionControl: false
  })

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19
  }).addTo(exportMap)

  sortedCities.value.forEach((city, index) => {
    const icon = L.divIcon({
      className: 'export-marker',
      html: `
        <div class="export-marker-circle">
          <span>${index + 1}</span>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    })

    const marker = L.marker([city.lat, city.lng], { icon }).addTo(exportMap)
    exportMarkers.push(marker)
  })

  if (sortedCities.value.length >= 2) {
    const points: L.LatLngExpression[] = sortedCities.value.map(city => [city.lat, city.lng])

    L.polyline(points, {
      weight: 4,
      opacity: 0.9,
      lineJoin: 'round',
      lineCap: 'round',
      color: '#ff6b6b'
    }).addTo(exportMap)
  }

  exportMap.fitBounds(bounds, { padding: [40, 40] })
}

async function handleExport() {
  if (!exportContainerRef.value || isExporting.value) return

  isExporting.value = true

  try {
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 500))

    const target = document.getElementById('export-content')
    if (!target) return

    const canvas = await html2canvas(target, {
      width: 1280,
      height: 720,
      scale: 2,
      backgroundColor: '#f0f4f8',
      useCORS: true,
      allowTaint: true,
      logging: false
    })

    const link = document.createElement('a')
    link.download = `我的旅行足迹_${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  } catch (error) {
    console.error('Export failed:', error)
    alert('导出失败，请稍后重试')
  } finally {
    isExporting.value = false
  }
}

function handleClose() {
  emit('close')
}

watch(() => props.visible, (newVal) => {
  if (newVal) {
    nextTick(() => {
      setTimeout(() => {
        initExportMap()
      }, 100)
    })
  } else {
    if (exportMap) {
      exportMap.remove()
      exportMap = null
    }
    exportMarkers.length = 0
  }
})
</script>

<style scoped>
.export-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  backdrop-filter: blur(4px);
}

.export-container {
  background: #f0f4f8;
  border-radius: 16px;
  width: 100%;
  max-width: 1320px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.3);
}

.export-header {
  padding: 24px 32px;
  background: white;
  border-bottom: 1px solid #e8e8e8;
}

.export-header h2 {
  margin: 0;
  font-size: 24px;
  color: #2c3e50;
  font-weight: 600;
}

.export-header p {
  margin: 4px 0 0;
  font-size: 14px;
  color: #95a5a6;
}

.export-content {
  flex: 1;
  overflow-y: auto;
  padding: 32px;
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 24px;
  width: 1280px;
  height: 720px;
  box-sizing: border-box;
  background: #f0f4f8;
}

.export-map-section {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
}

.export-map {
  width: 100%;
  height: 100%;
  min-height: 500px;
}

.export-map :deep(.leaflet-container) {
  background: #f0f4f8;
}

.export-map-overlay {
  position: absolute;
  top: 20px;
  left: 20px;
}

.trip-info {
  background: white;
  padding: 12px 20px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}

.trip-count {
  font-size: 28px;
  font-weight: 700;
  background: linear-gradient(135deg, #ff6b6b, #4ecdc4);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.trip-label {
  font-size: 14px;
  color: #7f8c8d;
}

.export-photos-section {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 16px;
}

.export-photo-card {
  background: white;
  border-radius: 10px;
  overflow: hidden;
  position: relative;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.photo-number {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 24px;
  height: 24px;
  background: #ff6b6b;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  z-index: 1;
}

.photo-wrapper {
  width: 100%;
  height: 140px;
  overflow: hidden;
  background: #f0f4f8;
}

.photo-wrapper img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.photo-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #ff6b6b, #4ecdc4);
  color: white;
  font-size: 48px;
  font-weight: 600;
}

.photo-info {
  padding: 12px;
}

.photo-info h4 {
  margin: 0 0 4px;
  font-size: 14px;
  color: #2c3e50;
  font-weight: 600;
}

.photo-info span {
  font-size: 12px;
  color: #95a5a6;
}

.export-footer {
  padding: 20px 32px;
  background: white;
  border-top: 1px solid #e8e8e8;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn {
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
  overflow: hidden;
}

.btn-secondary {
  background: #f0f0f0;
  color: #2c3e50;
}

.btn-secondary:hover {
  background: #e0e0e0;
}

.btn-primary {
  background: #ff6b6b;
  color: white;
}

.btn-primary:hover {
  background: #e55a5a;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn::after {
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

.btn:active::after {
  width: 200px;
  height: 200px;
}

.export-marker {
  background: transparent !important;
  border: none !important;
}

.export-marker-circle {
  width: 28px;
  height: 28px;
  background: #ff6b6b;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 12px;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(255, 107, 107, 0.5);
  border: 2px solid white;
}

.export-enter-active,
.export-leave-active {
  transition: opacity 0.3s ease;
}

.export-enter-from,
.export-leave-to {
  opacity: 0;
}

.export-enter-active .export-container,
.export-leave-active .export-container {
  transition: transform 0.3s ease;
}

.export-enter-from .export-container,
.export-leave-to .export-container {
  transform: scale(0.95);
}

@media (max-width: 1400px) {
  .export-content {
    width: 100%;
    height: auto;
    min-height: 600px;
    grid-template-columns: 1fr;
  }

  .export-map {
    min-height: 300px;
  }

  .export-photos-section {
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(2, 1fr);
  }
}
</style>
