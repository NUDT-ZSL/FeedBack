import type http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import store from './data/store.js'
import type { Recipe } from './types/index.js'

interface WebSocketClient extends WebSocket {
  userId?: string
  isAlive?: boolean
}

const clients = new Map<string, WebSocketClient>()

/**
 * Realtime channel: owns the WebSocket server, the userId→socket registry
 * and the heartbeat. Kept separate from the HTTP app so either transport
 * can evolve independently.
 */
export function setupRealtime(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ server })

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
  }, 30000)

  wss.on('close', () => {
    clearInterval(interval)
  })

  return wss
}

export function broadcastNewRecipe(recipe: Recipe, authorId: string): void {
  const author = store.findUserById(authorId)
  if (!author) return

  const notification = {
    type: 'NEW_RECIPE',
    payload: {
      recipe,
      authorName: author.username,
    },
  }

  const notificationStr = JSON.stringify(notification)

  author.followers.forEach((followerId) => {
    const client = clients.get(followerId)
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(notificationStr)
    }
  })
}
