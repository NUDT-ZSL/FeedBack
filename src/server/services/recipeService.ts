import store from '../data/store.js'
import { ApiError } from '../errors.js'
import type { Comment, Ingredient, Recipe, Step } from '../types/index.js'

export interface RecipePage {
  recipes: Recipe[]
  page: number
  limit: number
  total: number
  hasMore: boolean
}

export function listRecipes(rawPage?: string, rawLimit?: string): RecipePage {
  const page = parseInt(rawPage as string) || 1
  const limit = parseInt(rawLimit as string) || 12

  if (page < 1) {
    throw new ApiError(400, '页码必须大于0')
  }
  if (limit < 1 || limit > 100) {
    throw new ApiError(400, '每页数量必须在1到100之间')
  }

  const result = store.findRecipesPaginated(page, limit)
  return {
    recipes: result.data,
    page,
    limit,
    total: result.total,
    hasMore: result.hasMore,
  }
}

export function searchRecipes(query?: string): Recipe[] {
  const keyword = query || ''
  if (!keyword.trim()) {
    throw new ApiError(400, '搜索关键词不能为空')
  }
  return store.searchRecipes(keyword)
}

export interface CreateRecipeInput {
  title?: string
  description?: string
  coverImage?: string
  ingredients?: Omit<Ingredient, 'id'>[]
  steps?: Omit<Step, 'id'>[]
  tags?: string[]
  cookTime?: number
  difficulty?: 1 | 2 | 3 | 4 | 5
}

export function createRecipe(userId: string, username: string, body: CreateRecipeInput): Recipe {
  const { title, description, coverImage, ingredients, steps, tags, cookTime, difficulty } = body

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

  return store.addRecipe({
    authorId: userId,
    authorName: username,
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
}

export interface RecipeDetail extends Recipe {
  author: {
    id: string
    username: string
    avatar: string
    bio?: string
  } | null
}

export function getRecipeDetail(id: string): RecipeDetail {
  const recipe = store.findRecipeById(id)
  if (!recipe) {
    throw new ApiError(404, '食谱不存在')
  }

  const author = store.findUserById(recipe.authorId)
  return {
    ...recipe,
    author: author
      ? {
          id: author.id,
          username: author.username,
          avatar: author.avatar,
          bio: author.bio,
        }
      : null,
  }
}

function requireRecipe(id: string): Recipe {
  const recipe = store.findRecipeById(id)
  if (!recipe) {
    throw new ApiError(404, '食谱不存在')
  }
  return recipe
}

export function toggleLike(recipeId: string, userId: string): { liked: boolean; likesCount: number } {
  requireRecipe(recipeId)
  return store.likeRecipe(recipeId, userId)
}

export function toggleFavorite(
  recipeId: string,
  userId: string,
): { favorited: boolean; favoritesCount: number } {
  requireRecipe(recipeId)
  return store.favoriteRecipe(recipeId, userId)
}

export function addComment(recipeId: string, userId: string, content?: string): Comment {
  if (!content || !content.trim()) {
    throw new ApiError(400, '评论内容不能为空')
  }
  requireRecipe(recipeId)
  if (!store.findUserById(userId)) {
    throw new ApiError(404, '用户不存在')
  }

  const comment = store.addComment(recipeId, userId, content.trim())
  if (!comment) {
    throw new ApiError(500, '添加评论失败')
  }
  return comment
}
