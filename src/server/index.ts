import express, { type Request, type Response, type NextFunction } from 'express'
import http from 'http'
import cors from 'cors'
import dotenv from 'dotenv'
import userRoutes from './routes/userRoutes.js'
import { createRecipeRouter } from './routes/recipeRoutes.js'
import { initMockData } from './data/mockData.js'
import { createNotificationHub } from './ws/notificationHub.js'

dotenv.config()

const app = express()
const server = http.createServer(app)
const notificationHub = createNotificationHub(server)

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

app.use('/api/user', userRoutes)
app.use('/api/recipe', createRecipeRouter(notificationHub))

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

const PORT = process.env.PORT || 3001

async function startServer(): Promise<void> {
  await initMockData()

  server.listen(PORT, () => {
    console.log(`Server ready on port ${PORT}`)
    console.log(`WebSocket server ready on port ${PORT}`)
  })
}

startServer()

function shutdown(signal: string): void {
  console.log(`${signal} signal received`)
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export default app
