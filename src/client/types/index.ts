export interface User {
  id: string;
  username: string;
  email?: string;
  avatar: string;
  bio?: string;
  followers: string[];
  following: string[];
  createdAt: string;
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
  createdAt: string;
}

export interface Recipe {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  title: string;
  description?: string;
  coverImage: string;
  ingredients: Ingredient[];
  steps: Step[];
  cookTime: number;
  difficulty: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  likes: string[];
  favorites: string[];
  comments: Comment[];
  createdAt: string;
}

export interface FeedItem {
  id: string;
  recipeId: string;
  recipeTitle: string;
  recipeCover: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  publishedAt: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface LoginRequest {
  username?: string;
  email?: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email?: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface AppContextType {
  user: User | null;
  isAuthenticated: boolean;
  token: string | null;
  favorites: string[];
  following: string[];
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  register: (username: string, password: string, email?: string) => Promise<void>;
  toggleFavorite: (recipeId: string) => Promise<void>;
  toggleFollow: (userId: string) => Promise<void>;
  toggleLike: (recipeId: string) => void;
}
