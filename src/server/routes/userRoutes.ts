import { Router, type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import type { User, AuthRequest } from '../types/index.js'
import store from '../data/store.js'
import { authMiddleware, generateToken } from '../middleware/auth.js'

const router = Router()

router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, email, password } = req.body

    if (!username || !password) {
      res.status(400).json({
        success: false,
        error: '用户名和密码是必填项',
      })
      return
    }

    if (password.length < 6) {
      res.status(400).json({
        success: false,
        error: '密码至少需要6个字符',
      })
      return
    }

    if (email && store.findUserByEmail(email)) {
      res.status(400).json({
        success: false,
        error: '该邮箱已被注册',
      })
      return
    }

    if (store.findUserByUsername(username)) {
      res.status(400).json({
        success: false,
        error: '该用户名已被使用',
      })
      return
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = store.addUser({
      username,
      email,
      password: hashedPassword,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`,
    })

    const token = generateToken({ id: user.id, username: user.username })

    const { password: _password, ...userWithoutPassword } = user

    res.status(201).json({
      success: true,
      data: {
        user: userWithoutPassword,
        token,
      },
      message: '用户注册成功',
    })
  } catch {
    res.status(500).json({
      success: false,
      error: '注册失败',
    })
  }
})

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, username, password } = req.body

    if (!password) {
      res.status(400).json({
        success: false,
        error: '密码是必填项',
      })
      return
    }

    let user: User | undefined

    if (email) {
      user = store.findUserByEmail(email)
    } else if (username) {
      user = store.findUserByUsername(username)
    }

    if (!user || !user.password) {
      res.status(401).json({
        success: false,
        error: '用户名或密码错误',
      })
      return
    }

    const isPasswordValid = await bcrypt.compare(password, user.password)
    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        error: '用户名或密码错误',
      })
      return
    }

    const token = generateToken({ id: user.id, username: user.username })

    const { password: _password, ...userWithoutPassword } = user

    res.status(200).json({
      success: true,
      data: {
        user: userWithoutPassword,
        token,
      },
      message: '登录成功',
    })
  } catch {
    res.status(500).json({
      success: false,
      error: '登录失败',
    })
  }
})

router.get('/feed', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId

    if (!userId) {
      res.status(401).json({
        success: false,
        error: '需要认证',
      })
      return
    }

    const user = store.findUserById(userId)
    if (!user) {
      res.status(404).json({
        success: false,
        error: '用户不存在',
      })
      return
    }

    const feed = store.getFeedRecipes(user.following)

    res.status(200).json({
      success: true,
      data: feed,
    })
  } catch {
    res.status(500).json({
      success: false,
      error: '获取动态失败',
    })
  }
})

router.post('/follow', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const followerId = req.userId
    const { userId } = req.body

    if (!followerId) {
      res.status(401).json({
        success: false,
        error: '需要认证',
      })
      return
    }

    if (!userId) {
      res.status(400).json({
        success: false,
        error: '用户ID是必填项',
      })
      return
    }

    if (followerId === userId) {
      res.status(400).json({
        success: false,
        error: '不能关注自己',
      })
      return
    }

    const targetUser = store.findUserById(userId)
    if (!targetUser) {
      res.status(404).json({
        success: false,
        error: '用户不存在',
      })
      return
    }

    store.followUser(followerId, userId)

    res.status(200).json({
      success: true,
      message: '关注成功',
    })
  } catch {
    res.status(500).json({
      success: false,
      error: '关注失败',
    })
  }
})

router.post('/unfollow', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const followerId = req.userId
    const { userId } = req.body

    if (!followerId) {
      res.status(401).json({
        success: false,
        error: '需要认证',
      })
      return
    }

    if (!userId) {
      res.status(400).json({
        success: false,
        error: '用户ID是必填项',
      })
      return
    }

    const targetUser = store.findUserById(userId)
    if (!targetUser) {
      res.status(404).json({
        success: false,
        error: '用户不存在',
      })
      return
    }

    store.unfollowUser(followerId, userId)

    res.status(200).json({
      success: true,
      message: '取消关注成功',
    })
  } catch {
    res.status(500).json({
      success: false,
      error: '取消关注失败',
    })
  }
})

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params

    const user = store.findUserById(id)
    if (!user) {
      res.status(404).json({
        success: false,
        error: '用户不存在',
      })
      return
    }

    const { password: _password, ...userWithoutPassword } = user

    const userRecipes = store.findRecipesByAuthorId(id)

    res.status(200).json({
      success: true,
      data: {
        ...userWithoutPassword,
        recipes: userRecipes,
        recipesCount: userRecipes.length,
      },
    })
  } catch {
    res.status(500).json({
      success: false,
      error: '获取用户资料失败',
    })
  }
})

export default router
