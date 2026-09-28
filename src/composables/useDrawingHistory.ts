import { ref, computed } from 'vue'
import type { DrawOperation, StickyNoteData } from '@/types'
import { MAX_HISTORY_STEPS } from '@/types'

type HistoryItem =
  | { type: 'draw'; operation: DrawOperation }
  | { type: 'note-add'; note: StickyNoteData }
  | { type: 'note-update'; noteId: string; oldNote: StickyNoteData; newNote: StickyNoteData }
  | { type: 'note-delete'; note: StickyNoteData }

export function useDrawingHistory() {
  const undoStack = ref<HistoryItem[]>([])
  const redoStack = ref<HistoryItem[]>([])

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function push(item: HistoryItem) {
    undoStack.value.push(item)
    redoStack.value = []
    if (undoStack.value.length > MAX_HISTORY_STEPS) {
      undoStack.value.shift()
    }
  }

  function undo(): HistoryItem | null {
    if (!canUndo.value) return null
    const item = undoStack.value.pop()!
    redoStack.value.push(item)
    return item
  }

  function redo(): HistoryItem | null {
    if (!canRedo.value) return null
    const item = redoStack.value.pop()!
    undoStack.value.push(item)
    return item
  }

  function clear() {
    undoStack.value = []
    redoStack.value = []
  }

  function pushDrawOperation(operation: DrawOperation) {
    push({ type: 'draw', operation })
  }

  function pushNoteAdd(note: StickyNoteData) {
    push({ type: 'note-add', note })
  }

  function pushNoteUpdate(oldNote: StickyNoteData, newNote: StickyNoteData) {
    push({ type: 'note-update', noteId: oldNote.id, oldNote, newNote })
  }

  function pushNoteDelete(note: StickyNoteData) {
    push({ type: 'note-delete', note })
  }

  return {
    undoStack,
    redoStack,
    canUndo,
    canRedo,
    push,
    undo,
    redo,
    clear,
    pushDrawOperation,
    pushNoteAdd,
    pushNoteUpdate,
    pushNoteDelete
  }
}
