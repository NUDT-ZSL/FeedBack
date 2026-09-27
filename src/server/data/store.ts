import { v4 as uuidv4 } from 'uuid'
import type { User, Recipe, Ingredient, Step, Comment } from '../types/index.js'

interface Store {
  users: User[]
  recipes: Recipe[]
}

const store: Store = {
  users: [],
  recipes: [],
}

const recipeSearchIndex: Map<string, Set<string>> = new Map()

const addToSearchIndex = (recipe: Recipe): void => {
  const keywords = new Set<string>()

  recipe.title.toLowerCase().split(/\s+/).forEach(word => {
    if (word.length > 1) keywords.add(word)
  })

  recipe.tags.forEach(tag => {
    keywords.add(tag.toLowerCase())
  })

  keywords.forEach(keyword => {
    if (!recipeSearchIndex.has(keyword)) {
      recipeSearchIndex.set(keyword, new Set())
    }
    recipeSearchIndex.get(keyword)!.add(recipe.id)
  })
}

const removeFromSearchIndex = (recipe: Recipe): void => {
  recipeSearchIndex.forEach(recipeIds => {
    recipeIds.delete(recipe.id)
  })
}

export const clearAll = (): void => {
  store.users = []
  store.recipes = []
  recipeSearchIndex.clear()
}

export const addUser = (data: {
  username: string
  password: string
  avatar: string
  bio?: string
  email?: string
}): User => {
  const user: User = {
    id: uuidv4(),
    username: data.username,
    email: data.email,
    password: data.password,
    avatar: data.avatar,
    bio: data.bio,
    followers: [],
    following: [],
    createdAt: new Date(),
  }
  store.users.push(user)
  return user
}

export const findUserById = (id: string): User | undefined => {
  return store.users.find(u => u.id === id)
}

export const findUserByEmail = (email: string): User | undefined => {
  return store.users.find(u => u.email === email)
}

export const findUserByUsername = (username: string): User | undefined => {
  return store.users.find(u => u.username === username)
}

export const updateUser = (id: string, updates: Partial<User>): User | undefined => {
  const index = store.users.findIndex(u => u.id === id)
  if (index !== -1) {
    store.users[index] = { ...store.users[index], ...updates }
    return store.users[index]
  }
  return undefined
}

export const followUser = (followerId: string, userId: string): void => {
  const user = store.users.find(u => u.id === userId)
  const follower = store.users.find(u => u.id === followerId)
  if (user && follower && !user.followers.includes(followerId)) {
    user.followers.push(followerId)
    follower.following.push(userId)
  }
}

export const unfollowUser = (followerId: string, userId: string): void => {
  const user = store.users.find(u => u.id === userId)
  const follower = store.users.find(u => u.id === followerId)
  if (user && follower) {
    user.followers = user.followers.filter(id => id !== followerId)
    follower.following = follower.following.filter(id => id !== userId)
  }
}

export const addRecipe = (data: {
  authorId: string
  authorName: string
  authorAvatar: string
  title: string
  description?: string
  coverImage: string
  ingredients: Omit<Ingredient, 'id'>[]
  steps: Omit<Step, 'id'>[]
  cookTime: number
  difficulty: 1 | 2 | 3 | 4 | 5
  tags: string[]
}): Recipe => {
  const ingredients: Ingredient[] = data.ingredients.map(ing => ({
    ...ing,
    id: uuidv4(),
  }))

  const steps: Step[] = data.steps.map(step => ({
    ...step,
    id: uuidv4(),
  }))

  const recipe: Recipe = {
    id: uuidv4(),
    authorId: data.authorId,
    authorName: data.authorName,
    authorAvatar: data.authorAvatar,
    title: data.title,
    description: data.description,
    coverImage: data.coverImage,
    ingredients,
    steps,
    cookTime: data.cookTime,
    difficulty: data.difficulty,
    tags: data.tags,
    likes: [],
    favorites: [],
    comments: [],
    createdAt: new Date(),
  }

  store.recipes.push(recipe)
  addToSearchIndex(recipe)
  return recipe
}

export const findRecipeById = (id: string): Recipe | undefined => {
  return store.recipes.find(r => r.id === id)
}

export const findRecipesByAuthorId = (authorId: string): Recipe[] => {
  return store.recipes
    .filter(r => r.authorId === authorId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export const findRecipesPaginated = (
  page: number,
  limit: number
): { data: Recipe[]; total: number; hasMore: boolean } => {
  const allRecipes = [...store.recipes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
  const start = (page - 1) * limit
  const end = start + limit
  const data = allRecipes.slice(start, end)
  return {
    data,
    total: allRecipes.length,
    hasMore: end < allRecipes.length,
  }
}

export const searchRecipes = (query: string): Recipe[] => {
  const searchTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1)

  if (searchTerms.length === 0) {
    return store.recipes.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }

  const recipeIdScores = new Map<string, number>()

  searchTerms.forEach(term => {
    for (const [keyword, recipeIds] of recipeSearchIndex.entries()) {
      if (keyword.includes(term) || term.includes(keyword)) {
        recipeIds.forEach(id => {
          const score = keyword === term ? 2 : 1
          recipeIdScores.set(id, (recipeIdScores.get(id) || 0) + score)
        })
      }
    }

    store.recipes.forEach(recipe => {
      if (recipe.title.toLowerCase().includes(term)) {
        recipeIdScores.set(recipe.id, (recipeIdScores.get(recipe.id) || 0) + 3)
      }
      if (recipe.description?.toLowerCase().includes(term)) {
        recipeIdScores.set(recipe.id, (recipeIdScores.get(recipe.id) || 0) + 1)
      }
    })
  })

  const sortedIds = Array.from(recipeIdScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id)

  return sortedIds
    .map(id => store.recipes.find(r => r.id === id)!)
    .filter(Boolean)
}

export const getFeedRecipes = (userIds: string[]): Recipe[] => {
  return store.recipes
    .filter(r => userIds.includes(r.authorId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export const likeRecipe = (recipeId: string, userId: string): { liked: boolean; likesCount: number } => {
  const recipe = store.recipes.find(r => r.id === recipeId)
  if (!recipe) {
    return { liked: false, likesCount: 0 }
  }

  const likeIndex = recipe.likes.indexOf(userId)
  if (likeIndex === -1) {
    recipe.likes.push(userId)
    return { liked: true, likesCount: recipe.likes.length }
  } else {
    recipe.likes.splice(likeIndex, 1)
    return { liked: false, likesCount: recipe.likes.length }
  }
}

export const favoriteRecipe = (
  recipeId: string,
  userId: string
): { favorited: boolean; favoritesCount: number } => {
  const recipe = store.recipes.find(r => r.id === recipeId)
  if (!recipe) {
    return { favorited: false, favoritesCount: 0 }
  }

  const favIndex = recipe.favorites.indexOf(userId)
  if (favIndex === -1) {
    recipe.favorites.push(userId)
    return { favorited: true, favoritesCount: recipe.favorites.length }
  } else {
    recipe.favorites.splice(favIndex, 1)
    return { favorited: false, favoritesCount: recipe.favorites.length }
  }
}

export const addComment = (recipeId: string, userId: string, content: string): Comment | undefined => {
  const recipe = store.recipes.find(r => r.id === recipeId)
  const user = store.users.find(u => u.id === userId)
  if (!recipe || !user) return undefined

  const comment: Comment = {
    id: uuidv4(),
    userId,
    username: user.username,
    avatar: user.avatar,
    content,
    createdAt: new Date(),
  }

  recipe.comments.push(comment)
  return comment
}

export const updateRecipe = (id: string, updates: Partial<Recipe>): Recipe | undefined => {
  const index = store.recipes.findIndex(r => r.id === id)
  if (index !== -1) {
    const oldRecipe = store.recipes[index]
    removeFromSearchIndex(oldRecipe)
    store.recipes[index] = { ...store.recipes[index], ...updates }
    addToSearchIndex(store.recipes[index])
    return store.recipes[index]
  }
  return undefined
}

export default {
  users: store.users,
  recipes: store.recipes,
  clearAll,
  addUser,
  findUserById,
  findUserByEmail,
  findUserByUsername,
  updateUser,
  followUser,
  unfollowUser,
  addRecipe,
  findRecipeById,
  findRecipesByAuthorId,
  findRecipesPaginated,
  searchRecipes,
  getFeedRecipes,
  likeRecipe,
  favoriteRecipe,
  addComment,
  updateRecipe,
}
