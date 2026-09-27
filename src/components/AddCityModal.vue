<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-overlay" @click.self="handleClose">
        <div class="modal-container">
          <div class="modal-header">
            <h3>添加「{{ selectedCity?.name }}」到旅程</h3>
            <button class="close-btn" @click="handleClose">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>

          <div class="modal-body">
            <div class="form-group">
              <label>旅行日期</label>
              <input
                type="date"
                v-model="formData.date"
                class="form-input"
              />
            </div>

            <div class="form-group">
              <label>上传照片</label>
              <div class="photo-upload" @click="triggerFileInput">
                <div v-if="formData.photo" class="photo-preview">
                  <img :src="formData.photo" alt="预览" />
                </div>
                <div v-else class="upload-placeholder">
                  <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
                    <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                  </svg>
                  <span>点击上传照片</span>
                </div>
                <input
                  ref="fileInputRef"
                  type="file"
                  accept="image/*"
                  @change="handleFileChange"
                  style="display: none"
                />
              </div>
            </div>

            <div class="form-group">
              <label>旅行回忆 <span class="hint">（支持 Markdown）</span></label>
              <textarea
                v-model="formData.description"
                class="form-textarea"
                rows="6"
                placeholder="记录你的旅行故事..."
              ></textarea>
            </div>

            <div v-if="formData.description" class="markdown-preview">
              <div class="preview-title">预览：</div>
              <div class="preview-content" v-html="renderedMarkdown"></div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-secondary" @click="handleClose">取消</button>
            <button
              class="btn btn-primary"
              @click="handleSubmit"
              :disabled="isSubmitting"
            >
              <span v-if="isSubmitting">提交中...</span>
              <span v-else>添加到旅程</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { marked } from 'marked'
import type { SearchResult } from '../types'
import { useTravelStore } from '../store/travelStore'

const props = defineProps<{
  visible: boolean
  selectedCity: SearchResult | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'added'): void
}>()

const store = useTravelStore()
const fileInputRef = ref<HTMLInputElement | null>(null)
const isSubmitting = ref(false)

const formData = ref({
  date: new Date().toISOString().split('T')[0],
  photo: '',
  description: ''
})

const renderedMarkdown = computed(() => {
  if (!formData.value.description) return ''
  return marked(formData.value.description)
})

watch(() => props.visible, (newVal) => {
  if (newVal) {
    formData.value = {
      date: new Date().toISOString().split('T')[0],
      photo: '',
      description: ''
    }
  }
})

function triggerFileInput() {
  fileInputRef.value?.click()
}

function handleFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = (event) => {
    formData.value.photo = event.target?.result as string
  }
  reader.readAsDataURL(file)
}

function handleClose() {
  emit('close')
}

async function handleSubmit() {
  if (!props.selectedCity || isSubmitting.value) return

  isSubmitting.value = true

  try {
    await new Promise(resolve => setTimeout(resolve, 300))

    store.addCity({
      name: props.selectedCity.name,
      lat: props.selectedCity.lat,
      lng: props.selectedCity.lng,
      date: formData.value.date,
      photo: formData.value.photo,
      description: formData.value.description
    })

    store.saveToStorage()
    emit('added')
    emit('close')
  } finally {
    isSubmitting.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-container {
  background: white;
  border-radius: 12px;
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
}

.modal-header {
  padding: 20px 24px;
  border-bottom: 1px solid #e8e8e8;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
  color: #2c3e50;
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: #95a5a6;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s;
}

.close-btn:hover {
  background: #f0f0f0;
  color: #2c3e50;
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #2c3e50;
  margin-bottom: 8px;
}

.hint {
  font-weight: 400;
  color: #95a5a6;
  font-size: 12px;
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.form-input:focus {
  outline: none;
  border-color: #ff6b6b;
}

.form-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  font-size: 14px;
  resize: vertical;
  font-family: inherit;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.form-textarea:focus {
  outline: none;
  border-color: #ff6b6b;
}

.photo-upload {
  border: 2px dashed #e0e0e0;
  border-radius: 8px;
  padding: 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
}

.photo-upload:hover {
  border-color: #ff6b6b;
  background: #fff5f5;
}

.upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: #95a5a6;
  gap: 8px;
}

.photo-preview {
  max-height: 200px;
}

.photo-preview img {
  max-width: 100%;
  max-height: 200px;
  border-radius: 6px;
  object-fit: contain;
}

.markdown-preview {
  margin-top: 16px;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 6px;
}

.preview-title {
  font-size: 12px;
  color: #95a5a6;
  margin-bottom: 8px;
}

.preview-content {
  font-size: 14px;
  color: #2c3e50;
  line-height: 1.6;
}

.preview-content :deep(h1),
.preview-content :deep(h2),
.preview-content :deep(h3) {
  margin: 12px 0 8px;
}

.preview-content :deep(p) {
  margin: 8px 0;
}

.preview-content :deep(ul),
.preview-content :deep(ol) {
  padding-left: 24px;
  margin: 8px 0;
}

.preview-content :deep(code) {
  background: #e8e8e8;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
}

.modal-footer {
  padding: 16px 24px;
  border-top: 1px solid #e8e8e8;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn {
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
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
  background: rgba(255, 255, 255, 0.4);
  transform: translate(-50%, -50%);
  transition: width 0.2s, height 0.2s;
}

.btn:active::after {
  width: 200px;
  height: 200px;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-active .modal-container,
.modal-leave-active .modal-container {
  transition: transform 0.3s ease;
}

.modal-enter-from .modal-container,
.modal-leave-to .modal-container {
  transform: translateY(20px) scale(0.98);
}
</style>
