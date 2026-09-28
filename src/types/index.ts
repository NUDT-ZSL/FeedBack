export interface CodeAnalysis {
  lineCount: number;
  cyclomaticComplexity: number;
  commentRate: number;
  namingStyle: 'camelCase' | 'snake_case' | 'mixed';
  overallScore: number;
}

export interface Rating {
  _id: string;
  userId: string;
  snippetId: string;
  readability: number;
  elegance: number;
  efficiency: number;
  createdAt: string;
}

export interface CodeSnippet {
  _id: string;
  userId: string;
  code: string;
  language: 'javascript' | 'python';
  analysis: CodeAnalysis;
  ratings: Rating[];
  averageRating: number;
  createdAt: string;
}

export interface UserStats {
  _id: string;
  snippetId: string;
  code: string;
  language: string;
  createdAt: string;
  analysis: CodeAnalysis;
  averageRating: number;
  maxRating: number;
  minRating: number;
  ratingCount: number;
  ratingDistribution: number[];
}

export interface SubmitCodeRequest {
  code: string;
  language: string;
  userId: string;
}

export interface SubmitCodeResponse {
  success: boolean;
  analysis: CodeAnalysis;
  snippetId: string;
}

export interface RateSnippetRequest {
  snippetId: string;
  userId: string;
  readability: number;
  elegance: number;
  efficiency: number;
}

export interface RateSnippetResponse {
  success: boolean;
  averageRating: number;
}

export interface GetCodeSnippetsResponse {
  snippets: CodeSnippet[];
  total: number;
}

export interface GetUserStatsResponse {
  stats: UserStats[];
}

export interface GetStatsResponse {
  totalSnippets: number;
  totalRatings: number;
}
