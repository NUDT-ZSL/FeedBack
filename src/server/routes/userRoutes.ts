import { Router, type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import type { User, AuthRequest } from '../types/index.js'
import store from '../data/store.js'
import { authMiddleware, generateToken } from '../middleware/auth.js'
import { ApiError, handle, requireUserId } from '../lib/http.js'

const router = Router()

function toPublicUser(user: User): Omit<User, 'password'> {
  const { password, ...userWithoutPassword } = user
  void password
  return userWithoutPassword
}

router.post(
  '/register',
  handle('注册失败', async (req: Request, res: Response) => {
    const { username, email, password } = req.body

    if (!username || !password) {
      throw new ApiError(400, '用户名和密码是必填项')
    }

    if (password.length < 6) {
      throw new ApiError(400, '密码至少需要6个字符')
    }

    if (email && store.findUserByEmail(email)) {
      throw new ApiError(400, '该邮箱已被注册')
    }

    if (store.findUserByUsername(username)) {
      throw new ApiError(400, '该用户名已被使用')
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = store.addUser({
      username,
      email,
      password: hashedPassword,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`,
    })

    const token = generateToken({ id: user.id, username: user.username })

    res.status(201).json({
      success: true,
      data: {
        user: toPublicUser(user),
        token,
      },
      message: '用户注册成功',
    })
  }),
)

router.post(
  '/login',
  handle('登录失败', async (req: Request, res: Response) => {
    const { email, username, password } = req.body

    if (!password) {
      throw new ApiError(400, '密码是必填项')
    }

    let user: User | undefined

    if (email) {
      user = store.findUserByEmail(email)
    } else if (username) {
      user = store.findUserByUsername(username)
    }

    if (!user || !user.password) {
      throw new ApiError(401, '用户名或密码错误')
    }

    const isPasswordValid = await bcrypt.compare(password, user.password)
    if (!isPasswordValid) {
      throw new ApiError(401, '用户名或密码错误')
    }

    const token = generateToken({ id: user.id, username: user.username })

    res.status(200).json({
      success: true,
      data: {
        user: toPublicUser(user),
        token,
      },
      message: '登录成功',
    })
  }),
)

router.get(
  '/feed',
  authMiddleware,
  handle<AuthRequest>('获取动态失败', (req, res) => {
    const userId = requireUserId(req)

    const user = store.findUserById(userId)
    if (!user) {
      throw new ApiError(404, '用户不存在')
    }

    const feed = store.getFeedRecipes(user.following)

    res.status(200).json({
      success: true,
      data: feed,
    })
  }),
)

router.post(
  '/follow',
  authMiddleware,
  handle<AuthRequest>('关注失败', (req, res) => {
    const followerId = requireUserId(req)
    const { userId } = req.body

    if (!userId) {
      throw new ApiError(400, '用户ID是必填项')
    }

    if (followerId === userId) {
      throw new ApiError(400, '不能关注自己')
    }

    const targetUser = store.findUserById(userId)
    if (!targetUser) {
      throw new ApiError(404, '用户不存在')
    }

    store.followUser(followerId, userId)

    res.status(200).json({
      success: true,
      message: '关注成功',
    })
  }),
)

router.post(
  '/unfollow',
  authMiddleware,
  handle<AuthRequest>('取消关注失败', (req, res) => {
    const followerId = requireUserId(req)
    const { userId } = req.body

    if (!userId) {
      throw new ApiError(400, '用户ID是必填项')
    }

    const targetUser = store.findUserById(userId)
    if (!targetUser) {
      throw new ApiError(404, '用户不存在')
    }

    store.unfollowUser(followerId, userId)

    res.status(200).json({
      success: true,
      message: '取消关注成功',
    })
  }),
)

router.get(
  '/:id',
  handle('获取用户资料失败', (req: Request, res: Response) => {
    const user = store.findUserById(req.params.id)
    if (!user) {
      throw new ApiError(404, '用户不存在')
    }

    const userRecipes = store.findRecipesByAuthorId(user.id)

    res.status(200).json({
      success: true,
      data: {
        ...toPublicUser(user),
        recipes: userRecipes,
        recipesCount: userRecipes.length,
      },
    })
  }),
)

export default router
