import type { Recipe } from '../types';
import { request } from './client';

export interface CreateRecipePayload {
  title: string;
  coverImage: string;
  ingredients: { name: string; quantity: number; unit: string }[];
  steps: { order: number; description: string; imageUrl?: string }[];
  cookTime: number;
  difficulty: number;
  tags: string[];
}

export function createRecipe(token: string, payload: CreateRecipePayload): Promise<Recipe> {
  return request<Recipe>('/api/recipe', {
    method: 'POST',
    body: payload,
    token,
    errorFallback: '发布失败，请重试',
  });
}

export function toggleFavorite(
  recipeId: string,
  token: string,
): Promise<{ favorited: boolean }> {
  return request<{ favorited: boolean }>(`/api/recipe/${recipeId}/favorite`, {
    method: 'POST',
    body: {},
    token,
    errorFallback: '操作失败',
  });
}
