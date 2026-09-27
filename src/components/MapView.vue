<template>
  <div class="map-container" ref="mapContainerRef">
    <div ref="mapRef" class="map"></div>

    <button
      v-if="isMobile"
      class="mobile-sidebar-toggle"
      @click="store.toggleSidebar"
    >
      <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
        <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
      </svg>
    </button>

    <div class="map-legend" v-if="sortedCities.length > 1">
      <div class="legend-item">
        <div class="legend-line"></div>
        <span>旅行路线</span>
      </div>
      <div class="legend-item">
        <div class="legend-marker"></div>
        <span>旅行站点</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick, onBeforeUnmount } from 'vue'
import L from 'leaflet'
import { useTravelStore } from '../store/travelStore'
import { interpolateColor } from '../utils/mapUtils'
import type { City } from '../types'

const emit = defineEmits<{
  (e: 'marker-click', city: City): void
}>()

const store = useTravelStore()
const mapContainerRef = ref<HTMLDivElement | null>(null)
const mapRef = ref<HTMLDivElement | null>(null)
const isMobile = ref(false)

let map: L.Map | null = null
const markers: Map<string, L.Marker> = new Map()
let polyline: L.Polyline | null = null
let animationFrame: number | null = null

const sortedCities = store.sortedCities

function createCustomIcon(letter: string, isNew: boolean = false): L.DivIcon {
  const animationClass = isNew ? 'marker-animate' : ''
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div class="marker-container ${animationClass}">
        <div class="marker-circle">
          <span class="marker-letter">${letter}</span>
        </div>
      </div>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  })
}

function initMap() {
  if (!mapRef.value) return

  map = L.map(mapRef.value, {
    center: store.mapConfig.center,
    zoom: store.mapConfig.zoom,
    zoomControl: false,
    attributionControl: true
  })

  L.tileLayer(store.mapConfig.tileUrl, {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(map)

  L.control.zoom({ position: 'bottomright' }).addTo(map)

  map.on('click', () => {
    store.setActiveCity(null)
  })

  renderExistingCities()
  drawRoute()
}

function renderExistingCities() {
  if (!map) return

  sortedCities.forEach((city, index) => {
    addMarker(city, false)
  })
}

function addMarker(city: City, animate: boolean = true) {
  if (!map) return

  if (markers.has(city.id)) {
    markers.get(city.id)?.remove()
  }

  const icon = createCustomIcon(city.name.charAt(0), animate)
  const marker = L.marker([city.lat, city.lng], { icon })

  marker.on('click', (e) => {
    L.DomEvent.stopPropagation(e)
    emit('marker-click', city)
  })

  marker.addTo(map)
  markers.set(city.id, marker)
}

function removeMarker(cityId: string) {
  const marker = markers.get(cityId)
  if (marker) {
    marker.remove()
    markers.delete(cityId)
  }
}

function drawRoute() {
  if (!map || sortedCities.length < 2) {
    if (polyline) {
      polyline.remove()
      polyline = null
    }
    return
  }

  if (polyline) {
    polyline.remove()
  }

  const points: L.LatLngExpression[] = sortedCities.map(city => [city.lat, city.lng])

  polyline = L.polyline(points, {
    weight: 4,
    opacity: 0.9,
    lineJoin: 'round',
    lineCap: 'round',
    className: 'route-polyline'
  }).addTo(map)

  animateRouteDrawing()
}

function animateRouteDrawing() {
  if (!polyline || animationFrame) return

  const path = polyline.getElement()
  if (!path) return

  const length = (path as SVGPathElement).getTotalLength()
  let progress = 0
  const duration = 2000 * Math.max(1, sortedCities.length - 1)
  const startTime = performance.now()

  path.style.strokeDasharray = `${length}`
  path.style.strokeDashoffset = `${length}`

  function animate(currentTime: number) {
    const elapsed = currentTime - startTime
    progress = Math.min(elapsed / duration, 1)

    path.style.strokeDashoffset = `${length * (1 - progress)}`

    if (progress < 1) {
      animationFrame = requestAnimationFrame(animate)
    } else {
      path.style.strokeDasharray = 'none'
      path.style.strokeDashoffset = '0'
      applyGradientColors()
      animationFrame = null
    }
  }

  animationFrame = requestAnimationFrame(animate)
}

function applyGradientColors() {
  if (!polyline) return

  const path = polyline.getElement()
  if (!path) return

  let gradientId = 'route-gradient'
  let svg = path.closest('svg')
  if (!svg) return

  let defs = svg.querySelector('defs')
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    svg.insertBefore(defs, svg.firstChild)
  }

  let existingGradient = defs.querySelector(`#${gradientId}`)
  if (existingGradient) {
    existingGradient.remove()
  }

  const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient')
  gradient.setAttribute('id', gradientId)
  gradient.setAttribute('x1', '0%')
  gradient.setAttribute('y1', '0%')
  gradient.setAttribute('x2', '100%')
  gradient.setAttribute('y2', '0%')

  const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop')
  stop1.setAttribute('offset', '0%')
  stop1.setAttribute('stop-color', '#ff6b6b')

  const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop')
  stop2.setAttribute('offset', '100%')
  stop2.setAttribute('stop-color', '#4ecdc4')

  gradient.appendChild(stop1)
  gradient.appendChild(stop2)
  defs.appendChild(gradient)

  path.setAttribute('stroke', `url(#${gradientId})`)
}

function flyToCity(city: City) {
  if (!map) return
  map.flyTo([city.lat, city.lng], Math.max(map.getZoom(), 8), {
    duration: 0.8,
    easeLinearity: 0.25
  })
}

function invalidateSize() {
  if (map) {
    map.invalidateSize()
  }
}

watch(() => store.activeCity, (newCity) => {
  if (newCity) {
    nextTick(() => {
      flyToCity(newCity)
    })
  }
})

let previousLength = 0

watch(
  () => sortedCities.length,
  (newLength) => {
    if (newLength > previousLength && sortedCities.length > 0) {
      const newCity = sortedCities[sortedCities.length - 1]
      nextTick(() => {
        addMarker(newCity, true)
        drawRoute()
        flyToCity(newCity)
      })
    } else if (newLength < previousLength) {
      const currentIds = new Set(sortedCities.map(c => c.id))
      markers.forEach((_, id) => {
        if (!currentIds.has(id)) {
          removeMarker(id)
        }
      })
      drawRoute()
    }
    previousLength = newLength
  },
  { immediate: false }
)

function checkMobile() {
  isMobile.value = window.innerWidth < 768
}

onMounted(() => {
  checkMobile()
  previousLength = sortedCities.length
  nextTick(() => {
    initMap()
    window.addEventListener('resize', () => {
      invalidateSize()
      checkMobile()
    })
  })
})

onBeforeUnmount(() => {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame)
  }
  if (map) {
    map.remove()
    map = null
  }
  markers.clear()
})

defineExpose({
  flyToCity,
  invalidateSize
})
</script>

<style>
.map-container {
  position: relative;
  flex: 1;
  height: 100vh;
  overflow: hidden;
  background: #f0f4f8;
}

.map {
  width: 100%;
  height: 100%;
  background: #f0f4f8;
}

.map :deep(.leaflet-container) {
  background: #f0f4f8;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.map :deep(.leaflet-control-attribution) {
  background: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px 0 0 0;
}

.map :deep(.leaflet-control-zoom) {
  border: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.map :deep(.leaflet-control-zoom a) {
  width: 36px;
  height: 36px;
  line-height: 36px;
  font-size: 18px;
  color: #2c3e50;
  border-radius: 6px;
  margin-bottom: 4px;
  background: white;
  transition: all 0.2s;
}

.map :deep(.leaflet-control-zoom a:hover) {
  background: #f8f9fa;
  color: #ff6b6b;
}

.map :deep(.leaflet-control-zoom-in) {
  border-radius: 6px 6px 0 0 !important;
}

.map :deep(.leaflet-control-zoom-out) {
  border-radius: 0 0 6px 6px !important;
}

.custom-marker {
  background: transparent !important;
  border: none !important;
}

.marker-container {
  position: relative;
  width: 20px;
  height: 20px;
}

.marker-animate .marker-circle {
  animation: marker-pop 0.5s ease-out;
}

@keyframes marker-pop {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  60% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.marker-circle {
  width: 20px;
  height: 20px;
  background: #ff6b6b;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 11px;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(255, 107, 107, 0.5);
  border: 2px solid white;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.marker-container:hover .marker-circle {
  transform: scale(1.2);
  box-shadow: 0 4px 16px rgba(255, 107, 107, 0.6);
}

.marker-letter {
  line-height: 1;
}

.route-polyline {
  transition: stroke-dashoffset 0.1s linear;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.15));
}

.mobile-sidebar-toggle {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 500;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  border: none;
  background: white;
  color: #2c3e50;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  transition: all 0.2s;
}

.mobile-sidebar-toggle:hover {
  background: #f8f9fa;
  color: #ff6b6b;
}

.map-legend {
  position: absolute;
  bottom: 16px;
  left: 16px;
  background: white;
  padding: 12px 16px;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  z-index: 400;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #7f8c8d;
}

.legend-line {
  width: 24px;
  height: 4px;
  background: linear-gradient(90deg, #ff6b6b, #4ecdc4);
  border-radius: 2px;
}

.legend-marker {
  width: 14px;
  height: 14px;
  background: #ff6b6b;
  border-radius: 50%;
  border: 2px solid white;
  box-shadow: 0 1px 4px rgba(255, 107, 107, 0.4);
}

@media (min-width: 768px) {
  .mobile-sidebar-toggle {
    display: none;
  }
}
</style>
