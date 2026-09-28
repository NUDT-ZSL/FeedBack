import type { Request, Response } from 'express'

/**
 * Domain error carrying the HTTP status and client-facing message.
 * Services throw ApiError; the route wrapper maps it to the standard
 * `{ success: false, error }` response shape.
 */
export class ApiError extends Error {
  public readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type RouteHandler<Req extends Request = Request> = (
  req: Req,
  res: Response,
) => Promise<void> | void

/**
 * Single error boundary for route handlers. Expected failures (ApiError)
 * keep their status/message; unexpected exceptions degrade to the
 * route-specific 500 fallback message, matching the previous per-route
 * try/catch behavior.
 */
export function handleRoute<Req extends Request = Request>(
  fallbackMessage: string,
  handler: RouteHandler<Req>,
) {
  return async (req: Req, res: Response): Promise<void> => {
    try {
      await handler(req, res)
    } catch (error) {
      if (error instanceof ApiError) {
        res.status(error.status).json({
          success: false,
          error: error.message,
        })
        return
      }
      res.status(500).json({
        success: false,
        error: fallbackMessage,
      })
    }
  }
}
