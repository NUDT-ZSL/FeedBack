import express, { type Request, type Response, type NextFunction } from 'express'
import http from 'http'
import cors from 'cors'
import dotenv from 'dotenv'
import { WebSocketServer, WebSocket } from 'ws'
import userRoutes from './routes/userRoutes.js'
import recipeRoutes from './routes/recipeRoutes.js'
import store from './data/store.js'
import { initMockData } from './data/mockData.js'
import type { Recipe } from './types/index.js'

dotenv.config()

interface WebSocketClient extends WebSocket {
  userId?: string
  isAlive?: boolean
}

const app = express()
const server = http.createServer(app)
const wss = new WebSocketServer({ server })

const clients = new Map<string, WebSocketClient>()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

app.use('/api/user', userRoutes)
app.use('/api/recipe', recipeRoutes)

app.get('/api/health', (req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    message: 'ok',
  })
})

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((error: Error, req: Request, res: Response, next: NextFunction): void => {
  console.error('Server error:', error)
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

app.use((req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

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

const PORT = process.env.PORT || 3001

async function startServer(): Promise<void> {
  await initMockData()

  server.listen(PORT, () => {
    console.log(`Server ready on port ${PORT}`)
    console.log(`WebSocket server ready on port ${PORT}`)
  })
}

startServer()

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received')
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('SIGINT signal received')
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})

export default app
