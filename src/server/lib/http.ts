import type { NextFunction, Request, Response } from 'express'
import type { AuthRequest } from '../types/index.js'

/**
 * An error that maps directly onto an API error response. Route handlers throw
 * ApiError instead of hand-writing `res.status(...).json(...)` + `return`.
 */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Returns the authenticated user id or throws a 401 ApiError. */
export function requireUserId(req: AuthRequest): string {
  if (!req.userId) {
    throw new ApiError(401, '需要认证')
  }
  return req.userId
}

type RouteHandler<Req extends Request = Request> = (req: Req, res: Response) => Promise<void> | void

/**
 * The single error boundary for route handlers: an ApiError becomes its own
 * status/message; anything unexpected becomes a 500 with the route's fallback
 * message. Keeps handlers free of repetitive try/catch boilerplate.
 */
export function handle<Req extends Request = Request>(
  fallbackMessage: string,
  handler: RouteHandler<Req>,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await handler(req as Req, res)
    } catch (error) {
      if (res.headersSent) {
        next(error)
        return
      }
      if (error instanceof ApiError) {
        res.status(error.statusCode).json({ success: false, error: error.message })
        return
      }
      res.status(500).json({ success: false, error: fallbackMessage })
    }
  }
}
