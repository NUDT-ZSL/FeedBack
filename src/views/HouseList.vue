<template>
  <div class="house-list-page">
    <header class="page-header">
      <div class="header-inner">
        <div class="logo">
          <span class="logo-icon">🏠</span>
          <h1>租房优选</h1>
        </div>
        <button class="fav-toggle ripple-btn" v-ripple @click="openFav">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path :fill="favoriteCount > 0 ? '#ff5252' : 'none'" stroke="#ff5252" stroke-width="2"
              d="M12 21s-7-4.35-7-10a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 5.65-7 10-7 10z" />
          </svg>
          <span v-if="favoriteCount > 0" class="fav-badge">{{ favoriteCount }}</span>
        </button>
      </div>
    </header>

    <main class="page-main">
      <FilterBar
        :price-min="store.filter.priceMin"
        :price-max="store.filter.priceMax"
        :area-min="store.filter.areaMin"
        :area-max="store.filter.areaMax"
        :layout="store.filter.layout"
        :sort-type="store.sortType"
        @change="onFilterChange"
        @sort="onSort"
        @reset="onReset"
      />

      <div class="list-meta">
        <span>共找到 <strong>{{ displayedHouses.length }}</strong> 套房源</span>
      </div>

      <Transition name="fade-list" mode="out-in">
        <div :key="transitionKey" class="house-grid">
          <TransitionGroup name="stagger">
            <div
              v-for="(house, i) in displayedHouses"
              :key="house.id"
              class="grid-item"
              :style="{ animationDelay: `${i * 100}ms` }"
            >
              <HouseCard
                :house="house"
                :is-fav="store.isFavorite(house.id)"
                @toggle-favorite="store.toggleFavorite(house.id)"
              />
            </div>
          </TransitionGroup>
        </div>
      </Transition>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, inject, computed, watch } from 'vue'
import { useHouseStore } from '@/stores/house'
import { storeToRefs } from 'pinia'
import HouseCard from '@/components/HouseCard.vue'
import FilterBar from '@/components/FilterBar.vue'
import type { FilterState, SortType } from '@/types'

const store = useHouseStore()
const { filteredHouses, favoriteIds } = storeToRefs(store)
const openFav = inject<() => void>('openFavSidebar')!
const favoriteCount = computed(() => favoriteIds.value.length)

const displayedHouses = computed(() => filteredHouses.value)
const transitionKey = ref(0)

watch(
  () => [store.filter, store.sortType],
  () => {
    transitionKey.value++
  },
  { deep: true }
)

function onFilterChange(f: Partial<FilterState>) {
  store.setFilter(f)
}
function onSort(type: SortType) {
  store.setSort(type)
}
function onReset() {
  store.resetFilter()
}
</script>

<style scoped>
.house-list-page {
  min-height: 100vh;
  background: #faf3e0;
}
.page-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid #f0e6d0;
}
.header-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 14px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.logo {
  display: flex;
  align-items: center;
  gap: 8px;
}
.logo-icon {
  font-size: 26px;
}
.logo h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  background: linear-gradient(135deg, #ff8a65, #ff7043);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.fav-toggle {
  position: relative;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: none;
  background: #fff3e0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s;
}
.fav-toggle:hover {
  background: #ffe0b2;
  transform: scale(1.05);
}
.fav-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #ff5252;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
.page-main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}
.list-meta {
  margin-bottom: 14px;
  color: #666;
  font-size: 14px;
}
.list-meta strong {
  color: #ff7043;
  font-size: 16px;
}
.house-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}
.grid-item {
  opacity: 0;
  animation: fadeUp 0.4s ease-out forwards;
}
@keyframes fadeUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.fade-list-enter-active,
.fade-list-leave-active {
  transition: opacity 0.3s ease;
}
.fade-list-enter-from,
.fade-list-leave-to {
  opacity: 0;
}
.stagger-move {
  transition: transform 0.5s ease;
}
@media (max-width: 768px) {
  .house-grid {
    grid-template-columns: 1fr;
    gap: 14px;
  }
  .page-main {
    padding: 14px;
  }
}
</style>
