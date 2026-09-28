import type { Review, RatingDistributionItem } from '@/types';
import { movieManager } from '@/modules/movies/MovieManager';

const STORAGE_KEY = 'cinecollect_reviews';
const MIN_CONTENT_LENGTH = 50;
const MAX_CONTENT_LENGTH = 300;

class ReviewManager {
  private static instance: ReviewManager;
  private reviews: Map<string, Review[]> = new Map();

  private constructor() {
    this.loadReviews();
  }

  public static getInstance(): ReviewManager {
    if (!ReviewManager.instance) {
      ReviewManager.instance = new ReviewManager();
    }
    return ReviewManager.instance;
  }

  private loadReviews(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Review[];
        parsed.forEach((review) => {
          const movieReviews = this.reviews.get(review.movieId) || [];
          movieReviews.push(review);
          this.reviews.set(review.movieId, movieReviews);
        });
      }
    } catch (error) {
      console.error('Failed to load reviews:', error);
    }
  }

  private saveReviews(): void {
    try {
      const allReviews = Array.from(this.reviews.values()).flat();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allReviews));
    } catch (error) {
      console.error('Failed to save reviews:', error);
    }
  }

  private validateContent(content: string): { valid: boolean; message?: string } {
    const length = content.trim().length;
    if (length < MIN_CONTENT_LENGTH) {
      return {
        valid: false,
        message: `短评内容至少需要 ${MIN_CONTENT_LENGTH} 字，当前 ${length} 字`,
      };
    }
    if (length > MAX_CONTENT_LENGTH) {
      return {
        valid: false,
        message: `短评内容不能超过 ${MAX_CONTENT_LENGTH} 字，当前 ${length} 字`,
      };
    }
    return { valid: true };
  }

  public addReview(
    movieId: string,
    content: string,
    tags: string[] = []
  ): { success: boolean; review?: Review; error?: string } {
    const validation = this.validateContent(content);
    if (!validation.valid) {
      return { success: false, error: validation.message };
    }

    const review: Review = {
      id: `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      movieId,
      content: content.trim(),
      tags,
      createdAt: new Date().toISOString(),
    };

    const movieReviews = this.reviews.get(movieId) || [];
    movieReviews.push(review);
    this.reviews.set(movieId, movieReviews);
    this.saveReviews();

    return { success: true, review };
  }

  public deleteReview(reviewId: string): boolean {
    for (const [movieId, reviews] of this.reviews) {
      const index = reviews.findIndex((r) => r.id === reviewId);
      if (index !== -1) {
        reviews.splice(index, 1);
        if (reviews.length === 0) {
          this.reviews.delete(movieId);
        }
        this.saveReviews();
        return true;
      }
    }
    return false;
  }

  public updateReview(
    reviewId: string,
    content: string,
    tags?: string[]
  ): { success: boolean; review?: Review; error?: string } {
    const validation = this.validateContent(content);
    if (!validation.valid) {
      return { success: false, error: validation.message };
    }

    for (const reviews of this.reviews.values()) {
      const review = reviews.find((r) => r.id === reviewId);
      if (review) {
        review.content = content.trim();
        if (tags !== undefined) {
          review.tags = tags;
        }
        this.saveReviews();
        return { success: true, review };
      }
    }
    return { success: false, error: '短评不存在' };
  }

  public getReviewsByMovieId(movieId: string): Review[] {
    const reviews = this.reviews.get(movieId) || [];
    return [...reviews].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public getRatingDistribution(): RatingDistributionItem[] {
    const distribution: RatingDistributionItem[] = [
      { range: '1-2分', count: 0 },
      { range: '3-4分', count: 0 },
      { range: '5-6分', count: 0 },
      { range: '7-8分', count: 0 },
      { range: '9-10分', count: 0 },
    ];

    const allUserMovies = movieManager.getAllUserMovies();

    allUserMovies.forEach(({ userMovie }) => {
      const rating = userMovie.rating;
      if (rating >= 1 && rating <= 2) {
        distribution[0].count++;
      } else if (rating >= 3 && rating <= 4) {
        distribution[1].count++;
      } else if (rating >= 5 && rating <= 6) {
        distribution[2].count++;
      } else if (rating >= 7 && rating <= 8) {
        distribution[3].count++;
      } else if (rating >= 9 && rating <= 10) {
        distribution[4].count++;
      }
    });

    return distribution;
  }

  public getReviewCountByMovieId(movieId: string): number {
    return this.reviews.get(movieId)?.length || 0;
  }

  public getAllReviews(): Review[] {
    return Array.from(this.reviews.values())
      .flat()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export const reviewManager = ReviewManager.getInstance();
export default ReviewManager;
