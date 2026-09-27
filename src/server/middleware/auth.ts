import jwt from 'jsonwebtoken'
import type { Response, NextFunction } from 'express'
import type { AuthRequest } from '../types/index.js'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'
const JWT_EXPIRES_IN = '7d'

export function generateToken(payload: { id: string; username: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

export function verifyToken(token: string): { id: string; username: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { id: string; username: string }
  } catch {
    return null
  }
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: '未提供认证令牌',
    })
    return
  }

  const token = authHeader.substring(7)
  const decoded = verifyToken(token)

  if (!decoded) {
    res.status(401).json({
      success: false,
      error: '认证令牌无效或已过期',
    })
    return
  }

  req.user = decoded
  req.userId = decoded.id
  next()
}

export const optionalAuthMiddleware = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    const decoded = verifyToken(token)
    if (decoded) {
      req.user = decoded
      req.userId = decoded.id
    }
  }

  next()
}

export default authMiddleware
