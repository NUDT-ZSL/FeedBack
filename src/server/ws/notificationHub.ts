import type { Server } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import store from '../data/store.js'
import type { Recipe } from '../types/index.js'

interface WebSocketClient extends WebSocket {
  userId?: string
  isAlive?: boolean
}

export interface NotificationHub {
  broadcastNewRecipe: (recipe: Recipe, authorId: string) => void
  close: () => void
}

const HEARTBEAT_INTERVAL_MS = 30000

/**
 * Owns all WebSocket state: the client registry, heartbeat, and the
 * new-recipe broadcast to an author's followers.
 */
export function createNotificationHub(server: Server): NotificationHub {
  const wss = new WebSocketServer({ server })
  const clients = new Map<string, WebSocketClient>()

  wss.on('connection', (ws: WebSocketClient) => {
    ws.isAlive = true

    ws.on('pong', () => {
      ws.isAlive = true
    })

    ws.on('message', (data: string) => {
      try {
        const message = JSON.parse(data.toString())

        if (message.type === 'AUTH') {
          const { userId } = message.payload
          if (userId) {
            ws.userId = userId
            clients.set(userId, ws)
            ws.send(
              JSON.stringify({
                type: 'AUTH_SUCCESS',
                payload: { message: 'Authentication successful' },
              }),
            )
          }
        }
      } catch (error) {
        console.error('WebSocket message error:', error)
      }
    })

    ws.on('close', () => {
      if (ws.userId) {
        clients.delete(ws.userId)
      }
    })

    ws.on('error', (error) => {
      console.error('WebSocket error:', error)
    })
  })

  const interval = setInterval(() => {
    wss.clients.forEach((client) => {
      const wsClient = client as WebSocketClient
      if (wsClient.isAlive === false) {
        if (wsClient.userId) {
          clients.delete(wsClient.userId)
        }
        return client.terminate()
      }
      wsClient.isAlive = false
      client.ping()
    })
  }, HEARTBEAT_INTERVAL_MS)

  wss.on('close', () => {
    clearInterval(interval)
  })

  const broadcastNewRecipe = (recipe: Recipe, authorId: string): void => {
    const author = store.findUserById(authorId)
    if (!author) return

    const notificationStr = JSON.stringify({
      type: 'NEW_RECIPE',
      payload: {
        recipe,
        authorName: author.username,
      },
    })

    author.followers.forEach((followerId) => {
      const client = clients.get(followerId)
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(notificationStr)
      }
    })
  }

  return {
    broadcastNewRecipe,
    close: () => {
      clearInterval(interval)
      wss.close()
    },
  }
}
