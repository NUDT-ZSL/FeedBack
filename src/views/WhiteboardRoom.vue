<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { v4 as uuidv4 } from 'uuid'
import CanvasArea from '@/components/CanvasArea.vue'
import ToolBar from '@/components/ToolBar.vue'
import StickyNote from '@/components/StickyNote.vue'
import { useWebSocket } from '@/composables/useWebSocket'
import { useDrawingHistory } from '@/composables/useDrawingHistory'
import type {
  ToolType,
  Point,
  DrawOperation,
  StickyNoteData,
  User
} from '@/types'
import { PRESET_COLORS, NOTE_COLORS, MAX_NOTES, PRESET_COLORS as colors } from '@/types'

const route = useRoute()
const roomId = computed(() => (route.params.roomId as string) || 'default')

const currentUser = reactive<User>({
  id: uuidv4(),
  name: '用户' + Math.floor(Math.random() * 1000),
  color: colors[Math.floor(Math.random() * colors.length)],
  roomId: roomId.value
})

const canvasRef = ref<InstanceType<typeof CanvasArea> | null>(null)
const currentTool = ref<ToolType>('pen')
const currentColor = ref<string>(PRESET_COLORS[0])
const lineWidth = ref(4)
const isUserPanelOpen = ref(true)
const showNoteWarning = ref(false)
const draggedNoteId = ref<string | null>(null)
const dragOffset = reactive<Point>({ x: 0, y: 0 })
const selectedNoteId = ref<string | null>(null)

const operations = ref<DrawOperation[]>([])
const notes = ref<StickyNoteData[]>([])

const { canUndo, canRedo, pushDrawOperation, pushNoteAdd, pushNoteUpdate, pushNoteDelete, undo, redo, clear } =
  useDrawingHistory()

const {
  isConnected,
  users,
  connect,
  disconnect,
  on,
  sendDraw,
  sendUndo,
  sendRedo,
  sendNoteAdd,
  sendNoteUpdate,
  sendNoteDelete
} = useWebSocket(roomId.value, currentUser)

const onlineUsers = computed(() => {
  if (users.value.length === 0) {
    return [currentUser]
  }
  return users.value
})

function handleDrawComplete(operation: DrawOperation) {
  operation.userId = currentUser.id
  operations.value.push(operation)
  pushDrawOperation(operation)
  sendDraw(operation)
}

function handleCanvasClick(point: Point) {
  if (currentTool.value === 'note') {
    addNote(point)
  } else {
    selectedNoteId.value = null
  }
}

function addNote(point: Point) {
  if (notes.value.length >= MAX_NOTES) {
    showNoteWarning.value = true
    setTimeout(() => {
      showNoteWarning.value = false
    }, 3000)
    return
  }

  const note: StickyNoteData = {
    id: uuidv4(),
    userId: currentUser.id,
    content: '',
    x: point.x - 90,
    y: point.y - 80,
    color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)],
    timestamp: Date.now()
  }

  notes.value.push(note)
  pushNoteAdd(note)
  sendNoteAdd(note)
  selectedNoteId.value = note.id
}

function updateNote(noteId: string, updates: Partial<StickyNoteData>) {
  const note = notes.value.find((n) => n.id === noteId)
  if (!note) return

  const oldNote = { ...note }
  Object.assign(note, updates)
  pushNoteUpdate(oldNote, { ...note })
  sendNoteUpdate(noteId, updates)
}

function deleteNote(noteId: string) {
  const index = notes.value.findIndex((n) => n.id === noteId)
  if (index === -1) return

  const note = notes.value[index]
  notes.value.splice(index, 1)
  pushNoteDelete(note)
  sendNoteDelete(noteId)
  if (selectedNoteId.value === noteId) {
    selectedNoteId.value = null
  }
}

function selectNote(noteId: string) {
  selectedNoteId.value = noteId
}

function handleNoteDragStart(noteId: string, event: MouseEvent) {
  const note = notes.value.find((n) => n.id === noteId)
  if (!note) return

  draggedNoteId.value = noteId
  dragOffset.x = event.clientX - note.x
  dragOffset.y = event.clientY - note.y
}

function handleNoteDrag(noteId: string, event: MouseEvent) {
  if (draggedNoteId.value !== noteId) return

  const note = notes.value.find((n) => n.id === noteId)
  if (!note) return

  const oldNote = { ...note }
  note.x = event.clientX - dragOffset.x
  note.y = event.clientY - dragOffset.y
  pushNoteUpdate(oldNote, { ...note })
}

function handleNoteDragEnd(noteId: string) {
  if (draggedNoteId.value !== noteId) return

  const note = notes.value.find((n) => n.id === noteId)
  if (!note) return

  sendNoteUpdate(noteId, { x: note.x, y: note.y })
  draggedNoteId.value = null
}

function handleUndo() {
  const item = undo()
  if (!item) return

  if (item.type === 'draw') {
    const index = operations.value.findIndex((op) => op.id === item.operation.id)
    if (index !== -1) {
      operations.value.splice(index, 1)
    }
    sendUndo(item.operation.id)
  } else if (item.type === 'note-add') {
    const index = notes.value.findIndex((n) => n.id === item.note.id)
    if (index !== -1) {
      notes.value.splice(index, 1)
    }
    sendNoteDelete(item.note.id)
  } else if (item.type === 'note-update') {
    const note = notes.value.find((n) => n.id === item.noteId)
    if (note) {
      Object.assign(note, item.oldNote)
      sendNoteUpdate(item.noteId, item.oldNote)
    }
  } else if (item.type === 'note-delete') {
    notes.value.push(item.note)
    sendNoteAdd(item.note)
  }

  canvasRef.value?.redrawAll()
}

function handleRedo() {
  const item = redo()
  if (!item) return

  if (item.type === 'draw') {
    operations.value.push(item.operation)
    sendRedo(item.operation)
  } else if (item.type === 'note-add') {
    notes.value.push(item.note)
    sendNoteAdd(item.note)
  } else if (item.type === 'note-update') {
    const note = notes.value.find((n) => n.id === item.noteId)
    if (note) {
      Object.assign(note, item.newNote)
      sendNoteUpdate(item.noteId, item.newNote)
    }
  } else if (item.type === 'note-delete') {
    const index = notes.value.findIndex((n) => n.id === item.note.id)
    if (index !== -1) {
      notes.value.splice(index, 1)
    }
    sendNoteDelete(item.note.id)
  }

  canvasRef.value?.redrawAll()
}

function handleClearCanvas() {
  if (!confirm('确定要清空画布吗？此操作无法撤销。')) return
  operations.value = []
  notes.value = []
  clear()
  canvasRef.value?.clearCanvas()
}

function handleKeyDown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
    event.preventDefault()
    handleUndo()
  } else if (
    ((event.ctrlKey || event.metaKey) && event.key === 'y') ||
    ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'z')
  ) {
    event.preventDefault()
    handleRedo()
  } else if (event.key === 'Delete' && selectedNoteId.value) {
    event.preventDefault()
    deleteNote(selectedNoteId.value)
  }
}

function setupWebSocketListeners() {
  on('draw', (payload: { operation: DrawOperation }) => {
    if (payload.operation.userId !== currentUser.id) {
      operations.value.push(payload.operation)
      canvasRef.value?.redrawAll()
    }
  })

  on('undo', (payload: { userId: string; operationId: string }) => {
    if (payload.userId !== currentUser.id) {
      const index = operations.value.findIndex((op) => op.id === payload.operationId)
      if (index !== -1) {
        operations.value.splice(index, 1)
        canvasRef.value?.redrawAll()
      }
    }
  })

  on('redo', (payload: { userId: string; operation: DrawOperation }) => {
    if (payload.userId !== currentUser.id) {
      operations.value.push(payload.operation)
      canvasRef.value?.redrawAll()
    }
  })

  on('note-add', (payload: { note: StickyNoteData }) => {
    if (payload.note.userId !== currentUser.id) {
      notes.value.push(payload.note)
    }
  })

  on('note-update', (payload: { noteId: string; updates: Partial<StickyNoteData> }) => {
    const note = notes.value.find((n) => n.id === payload.noteId)
    if (note && note.userId !== currentUser.id) {
      Object.assign(note, payload.updates)
    }
  })

  on('note-delete', (payload: { noteId: string }) => {
    const index = notes.value.findIndex((n) => n.id === payload.noteId)
    if (index !== -1) {
      const note = notes.value[index]
      if (note.userId !== currentUser.id) {
        notes.value.splice(index, 1)
      }
    }
  })

  on('history', (payload: { operations: DrawOperation[]; notes: StickyNoteData[] }) => {
    operations.value = payload.operations || []
    notes.value = payload.notes || []
    canvasRef.value?.redrawAll()
  })
}

watch(roomId, (newRoomId) => {
  currentUser.roomId = newRoomId
  disconnect()
  operations.value = []
  notes.value = []
  clear()
  canvasRef.value?.clearCanvas()
  connect()
})

onMounted(() => {
  setupWebSocketListeners()
  connect()
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  disconnect()
})
</script>

<template>
  <div class="whiteboard-room">
    <div class="user-panel" :class="{ collapsed: !isUserPanelOpen }">
      <button class="toggle-btn" @click="isUserPanelOpen = !isUserPanelOpen">
        {{ isUserPanelOpen ? '◀' : '▶' }}
      </button>
      <div v-if="isUserPanelOpen" class="panel-content">
        <div class="panel-header">
          <h3>在线用户</h3>
          <span class="user-count">{{ onlineUsers.length }}</span>
        </div>
        <div class="user-list">
          <div v-for="user in onlineUsers" :key="user.id" class="user-item">
            <div class="user-avatar" :style="{ backgroundColor: user.color }">
              {{ user.name.charAt(0) }}
            </div>
            <div class="user-info">
              <span class="user-name">{{ user.name }}</span>
              <span v-if="user.id === currentUser.id" class="you-tag">你</span>
            </div>
          </div>
        </div>
        <div class="room-info">
          <span class="label">房间号</span>
          <span class="room-id">{{ roomId }}</span>
        </div>
      </div>
    </div>

    <div class="main-content">
      <ToolBar
        :current-tool="currentTool"
        :current-color="currentColor"
        :line-width="lineWidth"
        :can-undo="canUndo"
        :can-redo="canRedo"
        :is-connected="isConnected"
        @update:current-tool="currentTool = $event"
        @update:current-color="currentColor = $event"
        @update:line-width="lineWidth = $event"
        @undo="handleUndo"
        @redo="handleRedo"
        @clear-canvas="handleClearCanvas"
      />

      <div class="canvas-wrapper">
        <CanvasArea
          ref="canvasRef"
          :current-tool="currentTool"
          :current-color="currentColor"
          :line-width="lineWidth"
          :operations="operations"
          @draw-complete="handleDrawComplete"
          @canvas-click="handleCanvasClick"
        />

        <div class="notes-layer">
          <StickyNote
            v-for="note in notes"
            :key="note.id"
            :note="note"
            :is-selected="selectedNoteId === note.id"
            @update="updateNote(note.id, $event)"
            @delete="deleteNote(note.id)"
            @select="selectNote(note.id)"
            @drag-start="handleNoteDragStart(note.id, $event)"
            @drag="handleNoteDrag(note.id, $event)"
            @drag-end="handleNoteDragEnd(note.id)"
          />
        </div>

        <transition name="warning">
          <div v-if="showNoteWarning" class="note-warning">
            ⚠️ 便利贴数量已达上限（{{ MAX_NOTES }}个），请先删除一些再添加
          </div>
        </transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.whiteboard-room {
  width: 100%;
  height: 100%;
  display: flex;
  position: relative;
  background: #f5f5f5;
}

.user-panel {
  position: fixed;
  left: 0;
  top: 0;
  height: 100%;
  width: 240px;
  background: var(--panel-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-right: 1px solid var(--toolbar-border);
  z-index: 90;
  transition: transform var(--transition-normal);
  display: flex;
}

.user-panel.collapsed {
  transform: translateX(-240px);
}

.toggle-btn {
  position: absolute;
  right: -32px;
  top: 50%;
  transform: translateY(-50%);
  width: 32px;
  height: 48px;
  background: var(--panel-bg);
  backdrop-filter: blur(12px);
  border: 1px solid var(--toolbar-border);
  border-left: none;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-secondary);
  transition: all var(--transition-fast);
  z-index: 91;
}

.toggle-btn:hover {
  background: var(--primary-color);
  color: white;
}

.panel-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 80px 16px 16px;
  overflow-y: auto;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--toolbar-border);
}

.panel-header h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.user-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 8px;
  background: var(--primary-color);
  color: white;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.user-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.user-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  transition: background var(--transition-fast);
  animation: fadeInUp 0.3s ease;
}

.user-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}

.user-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.user-name {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.you-tag {
  flex-shrink: 0;
  font-size: 10px;
  padding: 2px 6px;
  background: var(--primary-color);
  color: white;
  border-radius: 4px;
}

.room-info {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--toolbar-border);
}

.room-info .label {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.room-id {
  display: block;
  font-size: 13px;
  color: var(--text-primary);
  font-family: 'Monaco', 'Consolas', monospace;
  word-break: break-all;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  margin-left: 240px;
  transition: margin-left var(--transition-normal);
}

.user-panel.collapsed + .main-content {
  margin-left: 0;
}

.canvas-wrapper {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.notes-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.notes-layer > * {
  pointer-events: auto;
}

.note-warning {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  background: #fff3cd;
  border: 1px solid #ffeeba;
  color: #856404;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  font-size: 14px;
  z-index: 200;
}

.warning-enter-active,
.warning-leave-active {
  transition: all var(--transition-normal);
}

.warning-enter-from,
.warning-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
}
</style>
