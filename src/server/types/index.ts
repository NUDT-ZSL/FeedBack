import type { Request } from 'express';

export interface User {
  id: string;
  username: string;
  email?: string;
  password?: string;
  avatar: string;
  bio?: string;
  followers: string[];
  following: string[];
  createdAt: Date | number;
}

export interface Ingredient {
  id: string;
  name: string;
  quantity: number;
  unit: string;
}

export interface Step {
  id: string;
  order: number;
  description: string;
  imageUrl?: string;
}

export interface Comment {
  id: string;
  userId: string;
  username: string;
  avatar: string;
  content: string;
  createdAt: Date;
}

export interface Recipe {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  title: string;
  description?: string;
  coverImage: string;
  image?: string;
  ingredients: Ingredient[];
  steps: Step[];
  cookTime: number;
  servings?: number;
  difficulty: 1 | 2 | 3 | 4 | 5 | 'easy' | 'medium' | 'hard';
  tags: string[];
  likes: string[];
  favorites: string[];
  comments: Comment[];
  createdAt: Date | number;
  updatedAt?: Date | number;
}

export interface FeedItem {
  id: string;
  recipeId: string;
  recipeTitle: string;
  recipeCover: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  publishedAt: Date;
}

export interface AuthRequest extends Request {
  userId?: string;
  user?: {
    id: string;
    username: string;
  };
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  user: Omit<User, 'password'>;
  token: string;
}

export interface CreateRecipeRequest {
  title: string;
  coverImage: string;
  ingredients: Omit<Ingredient, 'id'>[];
  steps: Omit<Step, 'id'>[];
  cookTime: number;
  difficulty: 1 | 2 | 3 | 4 | 5;
  tags: string[];
}

export interface RecipeListResponse {
  recipes: Recipe[];
  hasMore: boolean;
  total: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
