import { ref, onUnmounted } from 'vue'
import { io, type Socket } from 'socket.io-client'
import type {
  User,
  DrawOperation,
  StickyNoteData,
  WebSocketMessageType
} from '@/types'

export function useWebSocket(roomId: string, currentUser: User) {
  const socket = ref<Socket | null>(null)
  const isConnected = ref(false)
  const users = ref<User[]>([])

  const listeners = new Map<WebSocketMessageType, Set<(payload: any) => void>>()

  function connect() {
    if (socket.value) return

    socket.value = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    })

    socket.value.on('connect', () => {
      isConnected.value = true
      send('join', { roomId, user: currentUser })
    })

    socket.value.on('disconnect', () => {
      isConnected.value = false
    })

    socket.value.on('message', (message: { type: WebSocketMessageType; payload: any }) => {
      const callbacks = listeners.get(message.type)
      if (callbacks) {
        callbacks.forEach((cb) => cb(message.payload))
      }
    })

    socket.value.on('user-list', (payload: { users: User[] }) => {
      users.value = payload.users
      const callbacks = listeners.get('user-list')
      if (callbacks) {
        callbacks.forEach((cb) => cb(payload))
      }
    })

    socket.value.on('history', (payload: { operations: DrawOperation[]; notes: StickyNoteData[] }) => {
      const callbacks = listeners.get('history')
      if (callbacks) {
        callbacks.forEach((cb) => cb(payload))
      }
    })

    socket.value.on('draw', (payload: { operation: DrawOperation }) => {
      const callbacks = listeners.get('draw')
      if (callbacks) {
        callbacks.forEach((cb) => cb(payload))
      }
    })

    socket.value.on('undo', (payload: { userId: string; operationId: string }) => {
      const callbacks = listeners.get('undo')
      if (callbacks) {
        callbacks.forEach((cb) => cb(payload))
      }
    })

    socket.value.on('redo', (payload: { userId: string; operation: DrawOperation }) => {
      const callbacks = listeners.get('redo')
      if (callbacks) {
        callbacks.forEach((cb) => cb(payload))
      }
    })

    socket.value.on('note-add', (payload: { note: StickyNoteData }) => {
      const callbacks = listeners.get('note-add')
      if (callbacks) {
        callbacks.forEach((cb) => cb(payload))
      }
    })

    socket.value.on('note-update', (payload: { noteId: string; updates: Partial<StickyNoteData> }) => {
      const callbacks = listeners.get('note-update')
      if (callbacks) {
        callbacks.forEach((cb) => cb(payload))
      }
    })

    socket.value.on('note-delete', (payload: { noteId: string }) => {
      const callbacks = listeners.get('note-delete')
      if (callbacks) {
        callbacks.forEach((cb) => cb(payload))
      }
    })
  }

  function disconnect() {
    if (socket.value) {
      send('leave', { userId: currentUser.id })
      socket.value.disconnect()
      socket.value = null
      isConnected.value = false
    }
  }

  function send(type: WebSocketMessageType, payload: any) {
    if (socket.value?.connected) {
      socket.value.emit('message', { type, payload })
    }
  }

  function on(type: WebSocketMessageType, callback: (payload: any) => void) {
    if (!listeners.has(type)) {
      listeners.set(type, new Set())
    }
    listeners.get(type)!.add(callback)
  }

  function off(type: WebSocketMessageType, callback: (payload: any) => void) {
    const callbacks = listeners.get(type)
    if (callbacks) {
      callbacks.delete(callback)
    }
  }

  function sendDraw(operation: DrawOperation) {
    send('draw', { operation })
  }

  function sendUndo(operationId: string) {
    send('undo', { userId: currentUser.id, operationId })
  }

  function sendRedo(operation: DrawOperation) {
    send('redo', { userId: currentUser.id, operation })
  }

  function sendNoteAdd(note: StickyNoteData) {
    send('note-add', { note })
  }

  function sendNoteUpdate(noteId: string, updates: Partial<StickyNoteData>) {
    send('note-update', { noteId, updates })
  }

  function sendNoteDelete(noteId: string) {
    send('note-delete', { noteId })
  }

  onUnmounted(() => {
    disconnect()
  })

  return {
    socket,
    isConnected,
    users,
    connect,
    disconnect,
    send,
    on,
    off,
    sendDraw,
    sendUndo,
    sendRedo,
    sendNoteAdd,
    sendNoteUpdate,
    sendNoteDelete
  }
}
