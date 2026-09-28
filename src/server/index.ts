import http from 'http'
import dotenv from 'dotenv'
import app from './app.js'
import { setupRealtime } from './realtime.js'
import { initMockData } from './data/mockData.js'

dotenv.config()

// Re-exported so existing consumers of the server entry module keep working.
export { default as app } from './app.js'
export { broadcastNewRecipe } from './realtime.js'

const PORT = process.env.PORT || 3001

async function startServer(): Promise<void> {
  await initMockData()

  const server = http.createServer(app)
  setupRealtime(server)

  server.listen(PORT, () => {
    console.log(`Server ready on port ${PORT}`)
    console.log(`WebSocket server ready on port ${PORT}`)
  })

  const shutdown = (signal: string): void => {
    console.log(`${signal} signal received`)
    server.close(() => {
      console.log('Server closed')
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

startServer()

export default app
