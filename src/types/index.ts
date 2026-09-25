export interface Ingredient {
  name: string;
  checked: boolean;
}

export interface Step {
  id: number;
  content: string;
  expanded: boolean;
}

export interface Comment {
  id: string;
  nickname: string;
  content: string;
  createdAt: Date;
}

export interface Recipe {
  id: string;
  title: string;
  author: string;
  authorAvatar: string;
  thumbnail: string;
  image: string;
  description: string;
  category: string;
  tags: string[];
  likes: number;
  liked: boolean;
  ingredients: Ingredient[];
  steps: Step[];
  comments: Comment[];
  createdAt: Date;
}

export interface NewRecipeData {
  title: string;
  author: string;
  description: string;
  category: string;
  tags: string[];
  ingredients: string[];
  steps: string[];
  image?: string;
  thumbnail?: string;
}
