<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { StickyNoteData } from '@/types'

interface Props {
  note: StickyNoteData
  isSelected?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isSelected: false
})

const emit = defineEmits<{
  (e: 'update', updates: Partial<StickyNoteData>): void
  (e: 'delete'): void
  (e: 'select'): void
  (e: 'dragStart', event: MouseEvent): void
  (e: 'drag', event: MouseEvent): void
  (e: 'dragEnd'): void
}>()

const isEditing = ref(false)
const editContent = ref(props.note.content)
const noteRef = ref<HTMLDivElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const noteStyle = computed(() => ({
  left: props.note.x + 'px',
  top: props.note.y + 'px',
  backgroundColor: props.note.color
}))

function handleMouseDown(event: MouseEvent) {
  if (isEditing.value) return
  event.preventDefault()
  emit('select')
  emit('dragStart', event)

  function handleMouseMove(e: MouseEvent) {
    emit('drag', e)
  }

  function handleMouseUp() {
    emit('dragEnd')
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  }

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

function handleDoubleClick(event: MouseEvent) {
  event.stopPropagation()
  startEditing()
}

function startEditing() {
  isEditing.value = true
  editContent.value = props.note.content
  nextTick(() => {
    textareaRef.value?.focus()
    textareaRef.value?.select()
  })
}

function finishEditing() {
  if (editContent.value.trim() !== props.note.content) {
    emit('update', { content: editContent.value.trim() })
  }
  isEditing.value = false
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    finishEditing()
  }
  if (event.key === 'Escape') {
    isEditing.value = false
    editContent.value = props.note.content
  }
}

function handleDelete(event: MouseEvent) {
  event.stopPropagation()
  emit('delete')
}

watch(
  () => props.note.content,
  (newContent) => {
    if (!isEditing.value) {
      editContent.value = newContent
    }
  }
)

function nextTick(callback: () => void) {
  setTimeout(callback, 0)
}
</script>

<template>
  <div
    ref="noteRef"
    class="sticky-note"
    :class="{ selected: isSelected, editing: isEditing }"
    :style="noteStyle"
    @mousedown="handleMouseDown"
    @dblclick="handleDoubleClick"
  >
    <div class="note-header">
      <div class="note-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <button class="delete-btn" title="删除" @click="handleDelete">×</button>
    </div>
    <div class="note-content">
      <textarea
        v-if="isEditing"
        ref="textareaRef"
        v-model="editContent"
        class="edit-textarea"
        placeholder="输入内容..."
        @blur="finishEditing"
        @keydown="handleKeyDown"
      />
      <p v-else class="note-text" :class="{ empty: !note.content }">
        {{ note.content || '双击编辑...' }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.sticky-note {
  position: absolute;
  width: 180px;
  min-height: 160px;
  border-radius: 4px 4px 12px 4px;
  box-shadow: 2px 4px 12px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.1);
  cursor: move;
  user-select: none;
  transition: box-shadow var(--transition-fast), transform var(--transition-fast);
  animation: fadeInUp 0.3s ease;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.sticky-note::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 30px;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.03), transparent);
  pointer-events: none;
}

.sticky-note::after {
  content: '';
  position: absolute;
  bottom: 0;
  right: 0;
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, transparent 50%, rgba(0, 0, 0, 0.08) 50%);
  pointer-events: none;
}

.sticky-note:hover {
  box-shadow: 4px 8px 20px rgba(0, 0, 0, 0.2), 0 2px 6px rgba(0, 0, 0, 0.1);
  z-index: 10;
}

.sticky-note.selected {
  box-shadow: 0 0 0 3px var(--primary-color), 4px 8px 20px rgba(0, 0, 0, 0.2);
  z-index: 20;
}

.sticky-note.editing {
  cursor: text;
}

.note-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px 4px;
  height: 28px;
}

.note-dots {
  display: flex;
  gap: 3px;
}

.note-dots span {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.15);
}

.delete-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 14px;
  color: rgba(0, 0, 0, 0.4);
  opacity: 0;
  transition: all var(--transition-fast);
}

.sticky-note:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: rgba(0, 0, 0, 0.1);
  color: rgba(0, 0, 0, 0.8);
}

.note-content {
  flex: 1;
  padding: 4px 14px 14px;
  overflow: hidden;
}

.note-text {
  font-size: 13px;
  line-height: 1.5;
  color: rgba(0, 0, 0, 0.8);
  word-wrap: break-word;
  white-space: pre-wrap;
  margin: 0;
}

.note-text.empty {
  color: rgba(0, 0, 0, 0.3);
  font-style: italic;
}

.edit-textarea {
  width: 100%;
  height: 100%;
  min-height: 100px;
  border: none;
  background: transparent;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(0, 0, 0, 0.9);
  resize: none;
  outline: none;
  font-family: inherit;
}

.edit-textarea::placeholder {
  color: rgba(0, 0, 0, 0.3);
}
</style>
