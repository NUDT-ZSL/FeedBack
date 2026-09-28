import type { Movie, AnnualReportData, RatingDistributionItem } from '@/types';
import { movieManager } from '@/modules/movies/MovieManager';

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
    const userMovies = movieManager.getAllUserMovies();
    const years = new Set<number>();

    userMovies.forEach(({ userMovie }) => {
      const year = new Date(userMovie.addedAt).getFullYear();
      years.add(year);
    });

    return Array.from(years).sort((a, b) => b - a);
  }

  public generateAnnualReport(year: number): AnnualReportData {
    const userMovies = movieManager.getAllUserMovies();

    const yearMovies = userMovies.filter(({ userMovie }) => {
      const addedYear = new Date(userMovie.addedAt).getFullYear();
      return addedYear === year && userMovie.rating > 0;
    });

    const totalMovies = yearMovies.length;

    const averageRating =
      totalMovies > 0
        ? yearMovies.reduce((sum, { userMovie }) => sum + userMovie.rating, 0) / totalMovies
        : 0;

    const favoriteGenre = this.calculateFavoriteGenre(yearMovies);

    const topMovies = this.getTopRatedMovies(yearMovies, 3);

    const ratingDistribution = this.calculateRatingDistribution(yearMovies);

    return {
      year,
      totalMovies,
      averageRating: Math.round(averageRating * 10) / 10,
      favoriteGenre,
      topMovies,
      ratingDistribution,
    };
  }

  private calculateFavoriteGenre(
    yearMovies: { movie: Movie; userMovie: { rating: number } }[]
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
    yearMovies: { movie: Movie; userMovie: { rating: number } }[],
    topN: number
  ): Movie[] {
    return [...yearMovies]
      .sort((a, b) => b.userMovie.rating - a.userMovie.rating)
      .slice(0, topN)
      .map((item) => item.movie);
  }

  private calculateRatingDistribution(
    yearMovies: { userMovie: { rating: number } }[]
  ): RatingDistributionItem[] {
    const distribution: RatingDistributionItem[] = [
      { range: '1-2分', count: 0 },
      { range: '3-4分', count: 0 },
      { range: '5-6分', count: 0 },
      { range: '7-8分', count: 0 },
      { range: '9-10分', count: 0 },
    ];

    yearMovies.forEach(({ userMovie }) => {
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

  public getTotalWatchedMovies(): number {
    return movieManager
      .getAllUserMovies()
      .filter(({ userMovie }) => userMovie.rating > 0).length;
  }

  public getOverallAverageRating(): number {
    const ratedMovies = movieManager
      .getAllUserMovies()
      .filter(({ userMovie }) => userMovie.rating > 0);

    if (ratedMovies.length === 0) {
      return 0;
    }

    const sum = ratedMovies.reduce((acc, { userMovie }) => acc + userMovie.rating, 0);
    return Math.round((sum / ratedMovies.length) * 10) / 10;
  }
}

export const reportGenerator = ReportGenerator.getInstance();
export default ReportGenerator;
