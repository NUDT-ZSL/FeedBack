<template>
  <div
    class="city-card"
    :class="{ active: isActive }"
    @click="handleClick"
  >
    <div class="city-thumbnail">
      <img v-if="city.photo" :src="city.photo" :alt="city.name" />
      <div v-else class="city-placeholder">
        {{ city.name.charAt(0) }}
      </div>
    </div>
    <div class="city-info">
      <div class="city-name">{{ city.name }}</div>
      <div class="city-date">{{ formatDate(city.date) }}</div>
    </div>
    <button
      class="city-delete"
      @click.stop="handleDelete"
      title="删除"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { City } from '../types'
import { useTravelStore } from '../store/travelStore'

const props = defineProps<{
  city: City
}>()

const emit = defineEmits<{
  (e: 'select', city: City): void
}>()

const store = useTravelStore()

const isActive = computed(() => store.activeCityId === props.city.id)

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

function handleClick() {
  emit('select', props.city)
}

function handleDelete() {
  if (confirm(`确定要删除「${props.city.name}」吗？`)) {
    store.removeCity(props.city.id)
    store.saveToStorage()
  }
}
</script>

<style scoped>
.city-card {
  display: flex;
  align-items: center;
  padding: 12px;
  margin-bottom: 8px;
  border: 0.5px solid #e0e0e0;
  border-radius: 8px;
  background: #ffffff;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
}

.city-card:hover {
  background: #f0f8ff;
  transform: translateY(-3px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.city-card.active {
  border-color: #ff6b6b;
  background: #fff5f5;
}

.city-thumbnail {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  overflow: hidden;
  margin-right: 12px;
  flex-shrink: 0;
  background: #f0f4f8;
}

.city-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.city-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #ff6b6b, #4ecdc4);
  color: white;
  font-size: 20px;
  font-weight: 600;
}

.city-info {
  flex: 1;
  min-width: 0;
}

.city-name {
  font-size: 14px;
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.city-date {
  font-size: 12px;
  color: #95a5a6;
}

.city-delete {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #bdc3c7;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  opacity: 0;
}

.city-card:hover .city-delete {
  opacity: 1;
}

.city-delete:hover {
  background: #ffe0e0;
  color: #e74c3c;
}
</style>
