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

function extractToken(req: AuthRequest): string | null {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  return authHeader.substring(7)
}

function attachAuth(req: AuthRequest, decoded: { id: string; username: string }): void {
  req.user = decoded
  req.userId = decoded.id
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = extractToken(req)

  if (!token) {
    res.status(401).json({
      success: false,
      error: '未提供认证令牌',
    })
    return
  }

  const decoded = verifyToken(token)

  if (!decoded) {
    res.status(401).json({
      success: false,
      error: '认证令牌无效或已过期',
    })
    return
  }

  attachAuth(req, decoded)
  next()
}

export const optionalAuthMiddleware = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const token = extractToken(req)

  if (token) {
    const decoded = verifyToken(token)
    if (decoded) {
      attachAuth(req, decoded)
    }
  }

  next()
}

export default authMiddleware
