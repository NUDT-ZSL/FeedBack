import type { AuthResponse, Ingredient, Recipe, Step } from '../types';
import { apiRequest } from './client';

export interface CreateRecipeInput {
  title: string;
  coverImage: string;
  ingredients: Omit<Ingredient, 'id'>[];
  steps: Omit<Step, 'id'>[];
  cookTime: number;
  difficulty: number;
  tags: string[];
}

export const authApi = {
  login: (username: string, password: string) =>
    apiRequest<AuthResponse>('/api/user/login', '登录失败', {
      method: 'POST',
      body: { username, password },
    }),

  register: (username: string, password: string, email?: string) =>
    apiRequest<AuthResponse>('/api/user/register', '注册失败', {
      method: 'POST',
      body: { username, email, password },
    }),
};

export const recipeApi = {
  create: (token: string, input: CreateRecipeInput) =>
    apiRequest<Recipe>('/api/recipe', '发布失败，请重试', {
      method: 'POST',
      token,
      body: input,
    }),

  toggleFavorite: (token: string, recipeId: string) =>
    apiRequest<{ favorited: boolean }>(`/api/recipe/${recipeId}/favorite`, '操作失败', {
      method: 'POST',
      token,
    }),
};

export const userApi = {
  follow: (token: string, userId: string) =>
    apiRequest<unknown>('/api/user/follow', '操作失败', {
      method: 'POST',
      token,
      body: { userId },
    }),

  unfollow: (token: string, userId: string) =>
    apiRequest<unknown>('/api/user/unfollow', '操作失败', {
      method: 'POST',
      token,
      body: { userId },
    }),
};
