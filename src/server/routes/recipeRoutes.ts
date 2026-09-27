import { Router, type Request, type Response } from 'express'
import type { Recipe, AuthRequest, Comment } from '../types/index.js'
import store from '../data/store.js'
import { authMiddleware } from '../middleware/auth.js'
import { broadcastNewRecipe } from '../index.js'

const router = Router()

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 12

    if (page < 1) {
      res.status(400).json({
        success: false,
        error: '页码必须大于0',
      })
      return
    }

    if (limit < 1 || limit > 100) {
      res.status(400).json({
        success: false,
        error: '每页数量必须在1到100之间',
      })
      return
    }

    const result = store.findRecipesPaginated(page, limit)

    res.status(200).json({
      success: true,
      data: {
        recipes: result.data,
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore,
      },
    })
  } catch {
    res.status(500).json({
      success: false,
      error: '获取食谱列表失败',
    })
  }
})

router.get('/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const query = (req.query.q as string) || ''

    if (!query.trim()) {
      res.status(400).json({
        success: false,
        error: '搜索关键词不能为空',
      })
      return
    }

    const recipes = store.searchRecipes(query)

    res.status(200).json({
      success: true,
      data: recipes,
    })
  } catch {
    res.status(500).json({
      success: false,
      error: '搜索食谱失败',
    })
  }
})

router.post('/', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId
    const user = req.user
    const { title, description, coverImage, ingredients, steps, tags, cookTime, difficulty } = req.body

    if (!userId || !user) {
      res.status(401).json({
        success: false,
        error: '需要认证',
      })
      return
    }

    if (!title || !ingredients || !steps) {
      res.status(400).json({
        success: false,
        error: '标题、食材和步骤是必填项',
      })
      return
    }

    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      res.status(400).json({
        success: false,
        error: '食材必须是非空数组',
      })
      return
    }

    if (!Array.isArray(steps) || steps.length === 0) {
      res.status(400).json({
        success: false,
        error: '步骤必须是非空数组',
      })
      return
    }

    const author = store.findUserById(userId)
    if (!author) {
      res.status(404).json({
        success: false,
        error: '用户不存在',
      })
      return
    }

    const recipe = store.addRecipe({
      authorId: userId,
      authorName: user.username,
      authorAvatar: author.avatar,
      title,
      description,
      coverImage: coverImage || '',
      ingredients,
      steps,
      cookTime: cookTime || 0,
      difficulty: difficulty || 2,
      tags: tags || [],
    })

    res.status(201).json({
      success: true,
      data: recipe,
      message: '食谱创建成功',
    })
  } catch {
    res.status(500).json({
      success: false,
      error: '创建食谱失败',
    })
  }
})

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params

    const recipe = store.findRecipeById(id)
    if (!recipe) {
      res.status(404).json({
        success: false,
        error: '食谱不存在',
      })
      return
    }

    const author = store.findUserById(recipe.authorId)
    const authorInfo = author
      ? {
          id: author.id,
          username: author.username,
          avatar: author.avatar,
          bio: author.bio,
        }
      : null

    res.status(200).json({
      success: true,
      data: {
        ...recipe,
        author: authorInfo,
      },
    })
  } catch {
    res.status(500).json({
      success: false,
      error: '获取食谱详情失败',
    })
  }
})

router.post('/:id/like', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId
    const { id } = req.params

    if (!userId) {
      res.status(401).json({
        success: false,
        error: '需要认证',
      })
      return
    }

    const recipe = store.findRecipeById(id)
    if (!recipe) {
      res.status(404).json({
        success: false,
        error: '食谱不存在',
      })
      return
    }

    const result = store.likeRecipe(id, userId)

    res.status(200).json({
      success: true,
      data: result,
      message: result.liked ? '已点赞' : '已取消点赞',
    })
  } catch {
    res.status(500).json({
      success: false,
      error: '操作失败',
    })
  }
})

router.post('/:id/favorite', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId
    const { id } = req.params

    if (!userId) {
      res.status(401).json({
        success: false,
        error: '需要认证',
      })
      return
    }

    const recipe = store.findRecipeById(id)
    if (!recipe) {
      res.status(404).json({
        success: false,
        error: '食谱不存在',
      })
      return
    }

    const result = store.favoriteRecipe(id, userId)

    res.status(200).json({
      success: true,
      data: result,
      message: result.favorited ? '已收藏' : '已取消收藏',
    })
  } catch {
    res.status(500).json({
      success: false,
      error: '操作失败',
    })
  }
})

router.post('/:id/comment', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId
    const { id } = req.params
    const { content } = req.body

    if (!userId) {
      res.status(401).json({
        success: false,
        error: '需要认证',
      })
      return
    }

    if (!content || !content.trim()) {
      res.status(400).json({
        success: false,
        error: '评论内容不能为空',
      })
      return
    }

    const recipe = store.findRecipeById(id)
    if (!recipe) {
      res.status(404).json({
        success: false,
        error: '食谱不存在',
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

    const createdComment = store.addComment(id, userId, content.trim())

    if (!createdComment) {
      res.status(500).json({
        success: false,
        error: '添加评论失败',
      })
      return
    }

    res.status(201).json({
      success: true,
      data: createdComment,
      message: '评论添加成功',
    })
  } catch {
    res.status(500).json({
      success: false,
      error: '添加评论失败',
    })
  }
})

export default router
