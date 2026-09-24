import { Recipe, Comment, NewRecipeData } from '../types';

const API_BASE = '/api';

export const api = {
  async getRecipes(): Promise<Recipe[]> {
    const res = await fetch(`${API_BASE}/recipes`);
    if (!res.ok) throw new Error('获取菜谱失败');
    return res.json();
  },

  async getRecipe(id: string): Promise<Recipe> {
    const res = await fetch(`${API_BASE}/recipes/${id}`);
    if (!res.ok) throw new Error('菜谱不存在');
    return res.json();
  },

  async createRecipe(data: NewRecipeData): Promise<Recipe> {
    const res = await fetch(`${API_BASE}/recipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('创建菜谱失败');
    return res.json();
  },

  async likeRecipe(id: string, liked: boolean): Promise<{ likes: number; liked: boolean }> {
    const res = await fetch(`${API_BASE}/recipes/${id}/like`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liked }),
    });
    if (!res.ok) throw new Error('点赞失败');
    return res.json();
  },

  async addComment(id: string, nickname: string, content: string): Promise<Comment> {
    const res = await fetch(`${API_BASE}/recipes/${id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, content }),
    });
    if (!res.ok) throw new Error('评论失败');
    return res.json();
  },

  async toggleIngredient(id: string, ingredientIndex: number, checked: boolean): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/recipes/${id}/ingredients`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingredientIndex, checked }),
    });
    if (!res.ok) throw new Error('更新食材状态失败');
    return res.json();
  },

  async toggleStep(id: string, stepIndex: number, expanded: boolean): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/recipes/${id}/steps`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepIndex, expanded }),
    });
    if (!res.ok) throw new Error('更新步骤状态失败');
    return res.json();
  },

  async getCategories(): Promise<string[]> {
    const res = await fetch(`${API_BASE}/categories`);
    if (!res.ok) throw new Error('获取分类失败');
    return res.json();
  },
};
