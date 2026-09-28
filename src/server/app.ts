import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import userRoutes from './routes/userRoutes.js'
import recipeRoutes from './routes/recipeRoutes.js'

/**
 * HTTP application: middleware, API routes and the HTTP-level error
 * boundary. Transport-agnostic — the same app is mounted by the local
 * server bootstrap and by tests/serverless adapters.
 */
const app = express()

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

export default app
