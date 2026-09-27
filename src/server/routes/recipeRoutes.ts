import { Router, type Request, type Response } from 'express'
import type { AuthRequest } from '../types/index.js'
import store from '../data/store.js'
import { authMiddleware } from '../middleware/auth.js'
import { ApiError, handle, requireUserId } from '../lib/http.js'
import type { NotificationHub } from '../ws/notificationHub.js'

/**
 * Recipe routes. The notification hub is injected so this module no longer
 * depends on the server entrypoint (previously a circular import).
 */
export function createRecipeRouter(hub: NotificationHub): Router {
  const router = Router()

  router.get(
    '/',
    handle('获取食谱列表失败', (req: Request, res: Response) => {
      const page = parseInt(req.query.page as string) || 1
      const limit = parseInt(req.query.limit as string) || 12

      if (page < 1) {
        throw new ApiError(400, '页码必须大于0')
      }

      if (limit < 1 || limit > 100) {
        throw new ApiError(400, '每页数量必须在1到100之间')
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
    }),
  )

  router.get(
    '/search',
    handle('搜索食谱失败', (req: Request, res: Response) => {
      const query = (req.query.q as string) || ''

      if (!query.trim()) {
        throw new ApiError(400, '搜索关键词不能为空')
      }

      const recipes = store.searchRecipes(query)

      res.status(200).json({
        success: true,
        data: recipes,
      })
    }),
  )

  router.post(
    '/',
    authMiddleware,
    handle<AuthRequest>('创建食谱失败', (req, res) => {
      const userId = requireUserId(req)
      const user = req.user
      const { title, description, coverImage, ingredients, steps, tags, cookTime, difficulty } = req.body

      if (!user) {
        throw new ApiError(401, '需要认证')
      }

      if (!title || !ingredients || !steps) {
        throw new ApiError(400, '标题、食材和步骤是必填项')
      }

      if (!Array.isArray(ingredients) || ingredients.length === 0) {
        throw new ApiError(400, '食材必须是非空数组')
      }

      if (!Array.isArray(steps) || steps.length === 0) {
        throw new ApiError(400, '步骤必须是非空数组')
      }

      const author = store.findUserById(userId)
      if (!author) {
        throw new ApiError(404, '用户不存在')
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

      hub.broadcastNewRecipe(recipe, userId)

      res.status(201).json({
        success: true,
        data: recipe,
        message: '食谱创建成功',
      })
    }),
  )

  router.get(
    '/:id',
    handle('获取食谱详情失败', (req: Request, res: Response) => {
      const recipe = store.findRecipeById(req.params.id)
      if (!recipe) {
        throw new ApiError(404, '食谱不存在')
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
    }),
  )

  router.post(
    '/:id/like',
    authMiddleware,
    handle<AuthRequest>('操作失败', (req, res) => {
      const userId = requireUserId(req)

      const recipe = store.findRecipeById(req.params.id)
      if (!recipe) {
        throw new ApiError(404, '食谱不存在')
      }

      const result = store.likeRecipe(recipe.id, userId)

      res.status(200).json({
        success: true,
        data: result,
        message: result.liked ? '已点赞' : '已取消点赞',
      })
    }),
  )

  router.post(
    '/:id/favorite',
    authMiddleware,
    handle<AuthRequest>('操作失败', (req, res) => {
      const userId = requireUserId(req)

      const recipe = store.findRecipeById(req.params.id)
      if (!recipe) {
        throw new ApiError(404, '食谱不存在')
      }

      const result = store.favoriteRecipe(recipe.id, userId)

      res.status(200).json({
        success: true,
        data: result,
        message: result.favorited ? '已收藏' : '已取消收藏',
      })
    }),
  )

  router.post(
    '/:id/comment',
    authMiddleware,
    handle<AuthRequest>('添加评论失败', (req, res) => {
      const userId = requireUserId(req)
      const { content } = req.body

      if (!content || !content.trim()) {
        throw new ApiError(400, '评论内容不能为空')
      }

      const recipe = store.findRecipeById(req.params.id)
      if (!recipe) {
        throw new ApiError(404, '食谱不存在')
      }

      const user = store.findUserById(userId)
      if (!user) {
        throw new ApiError(404, '用户不存在')
      }

      const createdComment = store.addComment(recipe.id, userId, content.trim())

      if (!createdComment) {
        throw new ApiError(500, '添加评论失败')
      }

      res.status(201).json({
        success: true,
        data: createdComment,
        message: '评论添加成功',
      })
    }),
  )

  return router
}
