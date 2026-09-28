export interface Movie {
  id: string;
  title: string;
  director: string;
  year: number;
  posterUrl: string;
  genres: string[];
  synopsis: string;
}

export type WatchStatus = 'want_to_watch' | 'watched' | 'rewatched';

export interface UserMovie {
  movieId: string;
  status: WatchStatus;
  rating: number;
  addedAt: string;
}

export interface Review {
  id: string;
  movieId: string;
  content: string;
  tags: string[];
  createdAt: string;
}

export interface AnnualReportData {
  year: number;
  totalMovies: number;
  averageRating: number;
  favoriteGenre: string;
  topMovies: Movie[];
  ratingDistribution: RatingDistributionItem[];
}

export interface RatingDistributionItem {
  range: string;
  count: number;
}
