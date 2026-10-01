<template>
  <div class="favorites-page">
    <header class="page-header">
      <button class="back-btn ripple-btn" v-ripple @click="$router.back()">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="#333">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
        </svg>
      </button>
      <h1>我的收藏</h1>
      <div class="count-tag">{{ favoriteHouses.length }} 套</div>
    </header>

    <main class="page-main">
      <div v-if="favoriteHouses.length === 0" class="empty">
        <svg viewBox="0 0 24 24" width="80" height="80" fill="#eee">
          <path d="M12 21s-7-4.35-7-10a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 5.65-7 10-7 10z" />
        </svg>
        <h3>还没有收藏房源</h3>
        <p>快去首页逛逛，收藏心仪的房子吧</p>
        <button class="go-home ripple-btn" v-ripple @click="$router.push('/')">
          去首页
        </button>
      </div>

      <TransitionGroup v-else name="list" tag="div" class="fav-grid">
        <div
          v-for="(house, index) in favoriteHouses"
          :key="house.id"
          class="fav-wrap"
          draggable="true"
          @dragstart="onDragStart(index, $event)"
          @dragover.prevent
          @dragend="onDragEnd(index)"
          @drop.prevent="onDrop(index)"
          :class="{ dragging: dragFrom === index }"
        >
          <HouseCard
            :house="house"
            :is-fav="true"
            @toggle-favorite="removeFav(house.id)"
          />
        </div>
      </TransitionGroup>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useHouseStore } from '@/stores/house'
import { storeToRefs } from 'pinia'
import HouseCard from '@/components/HouseCard.vue'

const store = useHouseStore()
const { favoriteHouses } = storeToRefs(store)

const dragFrom = ref<number | null>(null)

function onDragStart(index: number, e: DragEvent) {
  dragFrom.value = index
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
}
function onDragEnd(toIndex: number) {
  if (dragFrom.value !== null && dragFrom.value !== toIndex) {
    store.reorderFavorites(dragFrom.value, toIndex)
  }
  dragFrom.value = null
}
function onDrop(index: number) {
  onDragEnd(index)
}
function removeFav(id: number) {
  store.toggleFavorite(id)
}
</script>

<style scoped>
.favorites-page {
  min-height: 100vh;
  background: #faf3e0;
}
.page-header {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid #f0e6d0;
}
.back-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: #fff3e0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: background 0.2s;
}
.back-btn:hover {
  background: #ffe0b2;
}
.page-header h1 {
  flex: 1;
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #333;
}
.count-tag {
  padding: 4px 12px;
  background: linear-gradient(135deg, #ff8a65, #ff7043);
  color: #fff;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
}
.page-main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  gap: 10px;
  text-align: center;
}
.empty h3 {
  margin: 8px 0 0;
  font-size: 18px;
  color: #333;
}
.empty p {
  margin: 0;
  font-size: 14px;
  color: #888;
}
.go-home {
  margin-top: 16px;
  padding: 10px 28px;
  background: linear-gradient(135deg, #ff8a65, #ff7043);
  color: #fff;
  border: none;
  border-radius: 22px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: all 0.2s;
}
.go-home:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(255, 112, 67, 0.4);
}
.fav-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}
.fav-wrap {
  transition: all 0.25s;
}
.fav-wrap.dragging {
  opacity: 0.4;
  transform: scale(0.98);
}
.list-enter-active {
  transition: all 0.4s ease;
}
.list-leave-active {
  transition: all 0.5s cubic-bezier(0.55, 0, 0.55, 0.2);
  position: absolute;
}
.list-move {
  transition: transform 0.5s cubic-bezier(0.55, 0, 0.1, 1);
}
.list-leave-to {
  opacity: 0;
  transform: rotateY(90deg) scale(0.8);
}
.ripple-btn {
  position: relative;
  overflow: hidden;
}
@media (max-width: 768px) {
  .fav-grid {
    grid-template-columns: 1fr;
    gap: 14px;
  }
  .page-main {
    padding: 14px;
  }
}
</style>
