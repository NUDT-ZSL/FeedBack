import { Router, type Request, type Response } from 'express'
import type { AuthRequest } from '../types/index.js'
import { authMiddleware } from '../middleware/auth.js'
import { handleRoute } from '../errors.js'
import * as recipeService from '../services/recipeService.js'

const router = Router()

router.get(
  '/',
  handleRoute('获取食谱列表失败', async (req: Request, res: Response) => {
    const result = recipeService.listRecipes(
      req.query.page as string,
      req.query.limit as string,
    )
    res.status(200).json({
      success: true,
      data: result,
    })
  }),
)

router.get(
  '/search',
  handleRoute('搜索食谱失败', async (req: Request, res: Response) => {
    const recipes = recipeService.searchRecipes(req.query.q as string)
    res.status(200).json({
      success: true,
      data: recipes,
    })
  }),
)

router.post(
  '/',
  authMiddleware,
  handleRoute('创建食谱失败', async (req: AuthRequest, res: Response) => {
    const recipe = recipeService.createRecipe(
      req.userId as string,
      req.user?.username as string,
      req.body,
    )
    res.status(201).json({
      success: true,
      data: recipe,
      message: '食谱创建成功',
    })
  }),
)

router.get(
  '/:id',
  handleRoute('获取食谱详情失败', async (req: Request, res: Response) => {
    const detail = recipeService.getRecipeDetail(req.params.id)
    res.status(200).json({
      success: true,
      data: detail,
    })
  }),
)

router.post(
  '/:id/like',
  authMiddleware,
  handleRoute('操作失败', async (req: AuthRequest, res: Response) => {
    const result = recipeService.toggleLike(req.params.id, req.userId as string)
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
  handleRoute('操作失败', async (req: AuthRequest, res: Response) => {
    const result = recipeService.toggleFavorite(req.params.id, req.userId as string)
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
  handleRoute('添加评论失败', async (req: AuthRequest, res: Response) => {
    const comment = recipeService.addComment(
      req.params.id,
      req.userId as string,
      req.body?.content,
    )
    res.status(201).json({
      success: true,
      data: comment,
      message: '评论添加成功',
    })
  }),
)

export default router
