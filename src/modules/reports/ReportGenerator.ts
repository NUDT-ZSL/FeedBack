import type { Movie, AnnualReportData } from '@/types';
import { movieManager } from '@/modules/movies/MovieManager';
import {
  computeAverageRating,
  computeRatingDistribution,
  dedupeUserMovies,
  filterEntriesByYear,
  isRated,
  type MovieEntry,
} from '@/modules/stats/ratingStats';

class ReportGenerator {
  private static instance: ReportGenerator;

  private constructor() {}

  public static getInstance(): ReportGenerator {
    if (!ReportGenerator.instance) {
      ReportGenerator.instance = new ReportGenerator();
    }
    return ReportGenerator.instance;
  }

  public getAvailableYears(): number[] {
    const userMovies = dedupeUserMovies(
      movieManager.getAllUserMovies().map((entry) => entry.userMovie)
    );
    const years = new Set<number>();

    userMovies.forEach((userMovie) => {
      const year = new Date(userMovie.addedAt).getFullYear();
      if (!Number.isNaN(year)) {
        years.add(year);
      }
    });

    return Array.from(years).sort((a, b) => b - a);
  }

  public generateAnnualReport(year: number): AnnualReportData {
    // 与短评统计共用同一套口径：当年全部收藏（含未评分）计入总数，
    // 同一影片跨年重复收藏按最早收藏时间归属，只计一次
    const yearMovies = filterEntriesByYear(movieManager.getAllUserMovies(), year);

    const totalMovies = yearMovies.length;

    const ratedCount = yearMovies.filter(({ userMovie }) => isRated(userMovie)).length;

    const averageRating = computeAverageRating(yearMovies.map((entry) => entry.userMovie));

    const favoriteGenre = this.calculateFavoriteGenre(yearMovies);

    const topMovies = this.getTopRatedMovies(yearMovies, 3);

    const ratingDistribution = computeRatingDistribution(
      yearMovies.map((entry) => entry.userMovie.rating)
    );

    return {
      year,
      totalMovies,
      ratedCount,
      averageRating,
      favoriteGenre,
      topMovies,
      ratingDistribution,
    };
  }

  private calculateFavoriteGenre(
    yearMovies: MovieEntry[]
  ): string {
    if (yearMovies.length === 0) {
      return '-';
    }

    const genreCount: Record<string, number> = {};

    yearMovies.forEach(({ movie }) => {
      movie.genres.forEach((genre) => {
        genreCount[genre] = (genreCount[genre] || 0) + 1;
      });
    });

    let favoriteGenre = '-';
    let maxCount = 0;

    Object.entries(genreCount).forEach(([genre, count]) => {
      if (count > maxCount) {
        maxCount = count;
        favoriteGenre = genre;
      }
    });

    return favoriteGenre;
  }

  private getTopRatedMovies(
    yearMovies: MovieEntry[],
    topN: number
  ): Movie[] {
    // 高分影片只取已评分条目，未评分（0 分）不参与排名
    return [...yearMovies]
      .filter(({ userMovie }) => isRated(userMovie))
      .sort((a, b) => b.userMovie.rating - a.userMovie.rating)
      .slice(0, topN)
      .map((item) => item.movie);
  }

  public getTotalWatchedMovies(): number {
    return dedupeUserMovies(movieManager.getAllUserMovies().map((entry) => entry.userMovie))
      .filter(isRated).length;
  }

  public getOverallAverageRating(): number {
    return computeAverageRating(
      dedupeUserMovies(movieManager.getAllUserMovies().map((entry) => entry.userMovie))
    );
  }
}

export const reportGenerator = ReportGenerator.getInstance();
export default ReportGenerator;
