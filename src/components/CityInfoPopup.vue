<template>
  <Teleport to="body">
    <Transition name="popup">
      <div v-if="visible" class="popup-overlay" @click.self="handleClose">
        <div class="popup-container" ref="popupRef">
          <button class="popup-close" @click="handleClose">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>

          <div v-if="city" class="popup-content">
            <div class="popup-photo" v-if="city.photo">
              <img :src="city.photo" :alt="city.name" />
            </div>

            <div class="popup-header">
              <div class="popup-title-row">
                <div class="popup-avatar">
                  {{ city.name.charAt(0) }}
                </div>
                <div>
                  <h3 class="popup-title">{{ city.name }}</h3>
                  <p class="popup-date">{{ formatDate(city.date) }}</p>
                </div>
              </div>
            </div>

            <div class="popup-description" v-if="city.description">
              <div v-html="renderedMarkdown"></div>
            </div>

            <div v-else class="popup-empty">
              还没有记录回忆文字
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import type { City } from '../types'

const props = defineProps<{
  visible: boolean
  city: City | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const renderedMarkdown = computed(() => {
  if (!props.city?.description) return ''
  return marked(props.city.description)
})

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

function handleClose() {
  emit('close')
}
</script>

<style scoped>
.popup-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1001;
  padding: 20px;
}

@media (min-width: 768px) {
  .popup-overlay {
    align-items: center;
  }
}

.popup-container {
  background: white;
  border-radius: 16px 16px 0 0;
  width: 100%;
  max-width: 560px;
  max-height: 80vh;
  overflow-y: auto;
  position: relative;
  box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.15);
}

@media (min-width: 768px) {
  .popup-container {
    border-radius: 16px;
    max-height: 70vh;
  }
}

.popup-close {
  position: sticky;
  top: 0;
  right: 0;
  float: right;
  margin: 12px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(4px);
  border: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  color: #7f8c8d;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  transition: all 0.2s;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.popup-close:hover {
  background: #f0f0f0;
  color: #2c3e50;
}

.popup-content {
  padding: 0 24px 24px;
}

.popup-photo {
  margin: -24px -24px 20px;
  max-height: 280px;
  overflow: hidden;
}

.popup-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.popup-header {
  margin-bottom: 20px;
}

.popup-title-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.popup-avatar {
  width: 52px;
  height: 52px;
  background: linear-gradient(135deg, #ff6b6b, #4ecdc4);
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 24px;
  font-weight: 600;
  flex-shrink: 0;
}

.popup-title {
  margin: 0;
  font-size: 22px;
  color: #2c3e50;
  font-weight: 600;
}

.popup-date {
  margin: 4px 0 0;
  font-size: 14px;
  color: #95a5a6;
}

.popup-description {
  font-size: 15px;
  line-height: 1.8;
  color: #34495e;
}

.popup-description :deep(h1) {
  font-size: 20px;
  margin: 16px 0 8px;
  color: #2c3e50;
}

.popup-description :deep(h2) {
  font-size: 18px;
  margin: 14px 0 6px;
  color: #2c3e50;
}

.popup-description :deep(h3) {
  font-size: 16px;
  margin: 12px 0 4px;
  color: #2c3e50;
}

.popup-description :deep(p) {
  margin: 10px 0;
}

.popup-description :deep(ul),
.popup-description :deep(ol) {
  padding-left: 24px;
  margin: 10px 0;
}

.popup-description :deep(li) {
  margin: 4px 0;
}

.popup-description :deep(a) {
  color: #ff6b6b;
  text-decoration: none;
}

.popup-description :deep(a:hover) {
  text-decoration: underline;
}

.popup-description :deep(code) {
  background: #f0f4f8;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 14px;
}

.popup-description :deep(blockquote) {
  border-left: 3px solid #ff6b6b;
  padding-left: 16px;
  margin: 12px 0;
  color: #7f8c8d;
  font-style: italic;
}

.popup-empty {
  text-align: center;
  padding: 40px 20px;
  color: #95a5a6;
  font-size: 14px;
}

.popup-enter-active,
.popup-leave-active {
  transition: opacity 0.3s ease;
}

.popup-enter-from,
.popup-leave-to {
  opacity: 0;
}

.popup-enter-active .popup-container {
  animation: slide-up 0.3s ease-out;
}

.popup-leave-active .popup-container {
  animation: slide-down 0.3s ease-in;
}

@keyframes slide-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

@keyframes slide-down {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(100%);
  }
}
</style>
