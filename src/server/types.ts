export interface Evaluation {
  id: string;
  courseName: string;
  teacher: string;
  rating: number;
  comment: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface StatsResponse {
  totalEvaluations: number;
  averageScore: number;
  topCourse: { name: string; score: number } | null;
  ratingDistribution: { rating: number; count: number; percentage: number }[];
  courseAverages: { courseName: string; averageScore: number }[];
  recentApproved: Evaluation[];
}
