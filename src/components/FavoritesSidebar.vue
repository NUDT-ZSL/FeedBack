<template>
  <Teleport to="body">
    <Transition name="sidebar">
      <div v-if="visible" class="sidebar-overlay" @click.self="$emit('close')">
        <div class="sidebar-panel">
          <div class="sidebar-header">
            <h2>我的收藏 ({{ favoriteHouses.length }})</h2>
            <button class="close-btn ripple-btn" v-ripple @click="$emit('close')">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="#666">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>
          <div class="sidebar-body">
            <div v-if="favoriteHouses.length === 0" class="empty">
              <svg viewBox="0 0 24 24" width="60" height="60" fill="#ddd">
                <path d="M12 21s-7-4.35-7-10a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 5.65-7 10-7 10z" />
              </svg>
              <p>暂无收藏房源</p>
            </div>
            <TransitionGroup
              v-else
              ref="listRef"
              tag="div"
              name="list"
              class="fav-list"
            >
              <div
                v-for="(house, index) in favoriteHouses"
                :key="house.id"
                class="fav-item"
                :draggable="true"
                @dragstart="onDragStart(index, $event)"
                @dragover.prevent="onDragOver(index, $event)"
                @dragend="onDragEnd"
                @drop.prevent="onDrop(index)"
                :class="{ dragging: dragIndex === index }"
              >
                <div class="drag-handle">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="#bbb">
                    <path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm0-6c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm0-6c0 1.1-.9 2-2 2S7 7.1 7 6s.9-2 2-2 2 .9 2 2zm6 12c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm0-6c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm0-6c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2z" />
                  </svg>
                </div>
                <img :src="house.images[0]" @click="goDetail(house.id)" />
                <div class="fav-info" @click="goDetail(house.id)">
                  <h4>{{ house.title }}</h4>
                  <p>{{ house.layout }} · {{ house.area }}㎡ · {{ house.location }}</p>
                  <p class="price">¥{{ house.price }}/月</p>
                </div>
                <div class="fav-actions">
                  <button class="chat-btn ripple-btn" v-ripple @click.stop="openChat(house)">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="#ff8a65">
                      <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
                    </svg>
                  </button>
                  <button class="remove-btn ripple-btn" v-ripple @click.stop="removeFav(house.id)">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="#e57373">
                      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                    </svg>
                  </button>
                </div>
              </div>
            </TransitionGroup>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useHouseStore } from '@/stores/house'
import { storeToRefs } from 'pinia'
import type { House } from '@/types'

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'open-chat', house: House): void
}>()

const store = useHouseStore()
const { favoriteHouses } = storeToRefs(store)
const router = useRouter()

const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

function goDetail(id: number) {
  router.push(`/house/${id}`)
  emit('close')
}

function removeFav(id: number) {
  store.toggleFavorite(id)
}

function openChat(house: House) {
  emit('open-chat', house)
}

function onDragStart(index: number, e: DragEvent) {
  dragIndex.value = index
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragOver(index: number, _e: DragEvent) {
  dragOverIndex.value = index
}

function onDragEnd() {
  if (dragIndex.value !== null && dragOverIndex.value !== null && dragIndex.value !== dragOverIndex.value) {
    store.reorderFavorites(dragIndex.value, dragOverIndex.value)
  }
  dragIndex.value = null
  dragOverIndex.value = null
}

function onDrop(index: number) {
  dragOverIndex.value = index
}
</script>

<style scoped>
.sidebar-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1500;
  display: flex;
  justify-content: flex-end;
}
.sidebar-panel {
  width: 100%;
  max-width: 400px;
  height: 100%;
  background: #faf3e0;
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.15);
}
.sidebar-header {
  padding: 18px 20px;
  background: linear-gradient(135deg, #fff, #fff8f0);
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #f0e6d0;
}
.sidebar-header h2 {
  margin: 0;
  font-size: 18px;
  color: #333;
}
.close-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: #f5f5f5;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}
.sidebar-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  color: #999;
}
.empty p {
  margin: 0;
  font-size: 14px;
}
.fav-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.fav-item {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-radius: 14px;
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  cursor: grab;
  transition: all 0.25s;
  position: relative;
}
.fav-item:hover {
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.12);
  transform: translateY(-2px);
}
.fav-item.dragging {
  opacity: 0.4;
  cursor: grabbing;
}
.drag-handle {
  cursor: grab;
  padding: 4px;
  flex-shrink: 0;
}
.fav-item img {
  width: 72px;
  height: 72px;
  border-radius: 10px;
  object-fit: cover;
  flex-shrink: 0;
  cursor: pointer;
}
.fav-info {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.fav-info h4 {
  margin: 0 0 4px 0;
  font-size: 14px;
  color: #333;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fav-info p {
  margin: 0 0 4px 0;
  font-size: 12px;
  color: #888;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fav-info .price {
  color: #ff7043;
  font-weight: 600;
  font-size: 14px;
}
.fav-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.chat-btn, .remove-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: #fff3e0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  transition: all 0.2s;
}
.chat-btn:hover {
  background: #ffe0b2;
}
.remove-btn {
  background: #ffebee;
}
.remove-btn:hover {
  background: #ffcdd2;
}
.ripple-btn {
  position: relative;
  overflow: hidden;
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
.sidebar-enter-active .sidebar-panel,
.sidebar-leave-active .sidebar-panel {
  transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}
.sidebar-enter-active,
.sidebar-leave-active {
  transition: opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}
.sidebar-enter-from .sidebar-panel,
.sidebar-leave-to .sidebar-panel {
  transform: translateX(100%);
}
.sidebar-enter-from,
.sidebar-leave-to {
  opacity: 0;
}
@media (max-width: 768px) {
  .sidebar-overlay {
    align-items: flex-end;
    justify-content: center;
  }
  .sidebar-panel {
    max-width: 100%;
    height: 85vh;
    border-radius: 20px 20px 0 0;
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
  }
  .sidebar-enter-active .sidebar-panel,
  .sidebar-leave-active .sidebar-panel {
    transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .sidebar-enter-from .sidebar-panel,
  .sidebar-leave-to .sidebar-panel {
    transform: translateY(100%);
  }
}
</style>
