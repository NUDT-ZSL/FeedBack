import bcrypt from 'bcryptjs'
import store from '../data/store.js'
import { generateToken } from '../middleware/auth.js'
import { ApiError } from '../errors.js'
import type { User, Recipe } from '../types/index.js'

export type PublicUser = Omit<User, 'password'>

export interface AuthResult {
  user: PublicUser
  token: string
}

export function toPublicUser(user: User): PublicUser {
  const publicUser = { ...user }
  delete publicUser.password
  return publicUser
}

function issueAuth(user: User): AuthResult {
  return {
    user: toPublicUser(user),
    token: generateToken({ id: user.id, username: user.username }),
  }
}

export async function registerUser(input: {
  username?: string
  email?: string
  password?: string
}): Promise<AuthResult> {
  const { username, email, password } = input

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

  return issueAuth(user)
}

export async function loginUser(input: {
  email?: string
  username?: string
  password?: string
}): Promise<AuthResult> {
  const { email, username, password } = input

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

  return issueAuth(user)
}

export function getUserFeed(userId: string): Recipe[] {
  const user = store.findUserById(userId)
  if (!user) {
    throw new ApiError(404, '用户不存在')
  }
  return store.getFeedRecipes(user.following)
}

export function followUser(followerId: string, targetUserId?: string): void {
  if (!targetUserId) {
    throw new ApiError(400, '用户ID是必填项')
  }
  if (followerId === targetUserId) {
    throw new ApiError(400, '不能关注自己')
  }
  if (!store.findUserById(targetUserId)) {
    throw new ApiError(404, '用户不存在')
  }
  store.followUser(followerId, targetUserId)
}

export function unfollowUser(followerId: string, targetUserId?: string): void {
  if (!targetUserId) {
    throw new ApiError(400, '用户ID是必填项')
  }
  if (!store.findUserById(targetUserId)) {
    throw new ApiError(404, '用户不存在')
  }
  store.unfollowUser(followerId, targetUserId)
}

export function getUserProfile(id: string): PublicUser & {
  recipes: Recipe[]
  recipesCount: number
} {
  const user = store.findUserById(id)
  if (!user) {
    throw new ApiError(404, '用户不存在')
  }
  const userRecipes = store.findRecipesByAuthorId(id)
  return {
    ...toPublicUser(user),
    recipes: userRecipes,
    recipesCount: userRecipes.length,
  }
}
