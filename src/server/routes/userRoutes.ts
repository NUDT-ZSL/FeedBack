import { Router, type Request, type Response } from 'express'
import type { AuthRequest } from '../types/index.js'
import { authMiddleware } from '../middleware/auth.js'
import { handleRoute } from '../errors.js'
import * as userService from '../services/userService.js'

const router = Router()

router.post(
  '/register',
  handleRoute('注册失败', async (req: Request, res: Response) => {
    const auth = await userService.registerUser(req.body)
    res.status(201).json({
      success: true,
      data: auth,
      message: '用户注册成功',
    })
  }),
)

router.post(
  '/login',
  handleRoute('登录失败', async (req: Request, res: Response) => {
    const auth = await userService.loginUser(req.body)
    res.status(200).json({
      success: true,
      data: auth,
      message: '登录成功',
    })
  }),
)

router.get(
  '/feed',
  authMiddleware,
  handleRoute('获取动态失败', async (req: AuthRequest, res: Response) => {
    const feed = userService.getUserFeed(req.userId as string)
    res.status(200).json({
      success: true,
      data: feed,
    })
  }),
)

router.post(
  '/follow',
  authMiddleware,
  handleRoute('关注失败', async (req: AuthRequest, res: Response) => {
    userService.followUser(req.userId as string, req.body?.userId)
    res.status(200).json({
      success: true,
      message: '关注成功',
    })
  }),
)

router.post(
  '/unfollow',
  authMiddleware,
  handleRoute('取消关注失败', async (req: AuthRequest, res: Response) => {
    userService.unfollowUser(req.userId as string, req.body?.userId)
    res.status(200).json({
      success: true,
      message: '取消关注成功',
    })
  }),
)

router.get(
  '/:id',
  handleRoute('获取用户资料失败', async (req: Request, res: Response) => {
    const profile = userService.getUserProfile(req.params.id)
    res.status(200).json({
      success: true,
      data: profile,
    })
  }),
)

export default router
