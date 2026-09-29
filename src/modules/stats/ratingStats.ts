import type { Movie, UserMovie, AnnualReportData, RatingDistributionItem } from '@/types';

/**
 * 统一评分统计口径（ReviewManager 与 ReportGenerator 共用）：
 *
 * 1. 计入统计的条目：所有收藏条目，观看状态（想看/已看/二刷）不影响计入。
 * 2. 评分有效范围：[0, 10] 的有限数值；NaN、Infinity、越界值视为脏数据，不参与任何统计。
 * 3. 评分 0 表示「未评分」：计入收藏总数与评分分布（落入 0-2 区间），
 *    但不计入平均分与高分影片（Top N）。
 * 4. 评分分布区间：半开区间 [0,2) [2,4) [4,6) [6,8)，最后一段闭区间 [8,10]。
 *    0~10 内任意取值（含边界与小数）归属唯一且不遗漏，
 *    各区间计数之和恒等于参与统计的条目数。
 * 5. 年度报告按收藏时间（addedAt）归属年份；同一影片同一年多次收藏按 movieId 去重
 *    （保留最早一条收藏记录），跨年收藏在各年份分别计入一次。
 */

export const RATING_MIN = 0;
export const RATING_MAX = 10;

export interface RatingBucket {
  range: string;
  min: number;
  max: number;
  /** 最后一段为 true，包含上界（用于收纳满分 10） */
  includeMax: boolean;
}

export const RATING_BUCKETS: RatingBucket[] = [
  { range: '0-2分', min: 0, max: 2, includeMax: false },
  { range: '2-4分', min: 2, max: 4, includeMax: false },
  { range: '4-6分', min: 4, max: 6, includeMax: false },
  { range: '6-8分', min: 6, max: 8, includeMax: false },
  { range: '8-10分', min: 8, max: 10, includeMax: true },
];

/** 评分是否为合法数值（[0,10] 的有限数） */
export function isValidRating(rating: unknown): rating is number {
  return (
    typeof rating === 'number' &&
    Number.isFinite(rating) &&
    rating >= RATING_MIN &&
    rating <= RATING_MAX
  );
}

/** 是否已评分（合法且大于 0；0 表示未评分） */
export function isRated(rating: unknown): rating is number {
  return isValidRating(rating) && rating > 0;
}

/** 将合法评分归入唯一区间；非法评分返回 -1 */
export function assignRatingBucket(rating: number): number {
  if (!isValidRating(rating)) {
    return -1;
  }
  for (let i = 0; i < RATING_BUCKETS.length; i++) {
    const bucket = RATING_BUCKETS[i];
    const inRange = bucket.includeMax
      ? rating >= bucket.min && rating <= bucket.max
      : rating >= bucket.min && rating < bucket.max;
    if (inRange) {
      return i;
    }
  }
  return -1;
}

/**
 * 计算评分分布。非法评分被剔除；
 * 返回值中各区间计数之和等于合法评分的条目数。
 */
export function computeRatingDistribution(ratings: number[]): RatingDistributionItem[] {
  const distribution: RatingDistributionItem[] = RATING_BUCKETS.map((bucket) => ({
    range: bucket.range,
    count: 0,
  }));

  ratings.forEach((rating) => {
    const index = assignRatingBucket(rating);
    if (index >= 0) {
      distribution[index].count++;
    }
  });

  return distribution;
}

export interface UserMovieEntry {
  movie: Movie;
  userMovie: UserMovie;
}

/**
 * 按 movieId 去重，保留 addedAt 最早的一条记录。
 * 保证同一影片在同一统计周期内只计一次，与数据来源无关。
 */
export function dedupeEntriesByMovieId(entries: UserMovieEntry[]): UserMovieEntry[] {
  const byMovieId = new Map<string, UserMovieEntry>();

  entries.forEach((entry) => {
    const existing = byMovieId.get(entry.userMovie.movieId);
    if (!existing) {
      byMovieId.set(entry.userMovie.movieId, entry);
      return;
    }
    const existingTime = new Date(existing.userMovie.addedAt).getTime();
    const currentTime = new Date(entry.userMovie.addedAt).getTime();
    if (currentTime < existingTime) {
      byMovieId.set(entry.userMovie.movieId, entry);
    }
  });

  return Array.from(byMovieId.values());
}

/** 过滤出指定年份（按收藏时间 addedAt 归属）的条目，并按 movieId 去重 */
export function filterEntriesByYear(entries: UserMovieEntry[], year: number): UserMovieEntry[] {
  const yearEntries = entries.filter(
    ({ userMovie }) => new Date(userMovie.addedAt).getFullYear() === year
  );
  return dedupeEntriesByMovieId(yearEntries);
}

function calculateFavoriteGenre(entries: UserMovieEntry[]): string {
  if (entries.length === 0) {
    return '-';
  }

  const genreCount: Record<string, number> = {};
  entries.forEach(({ movie }) => {
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

/** 高分影片：仅已评分（rating > 0）的条目参与，按评分降序取前 topN */
export function getTopRatedMovies(entries: UserMovieEntry[], topN: number): Movie[] {
  return entries
    .filter(({ userMovie }) => isRated(userMovie.rating))
    .sort((a, b) => b.userMovie.rating - a.userMovie.rating)
    .slice(0, topN)
    .map((item) => item.movie);
}

/** 平均分：仅已评分条目参与；无已评分条目时为 0，保留 1 位小数 */
export function computeAverageRating(entries: UserMovieEntry[]): number {
  const rated = entries.filter(({ userMovie }) => isRated(userMovie.rating));
  if (rated.length === 0) {
    return 0;
  }
  const sum = rated.reduce((acc, { userMovie }) => acc + userMovie.rating, 0);
  return Math.round((sum / rated.length) * 10) / 10;
}

/**
 * 由年度条目集合生成年度报告数据。
 * 入参应已通过 filterEntriesByYear 过滤去重；收藏总数 = 条目数，
 * 评分分布之和与收藏总数一致，可互相核对。
 */
export function computeAnnualReportData(year: number, yearEntries: UserMovieEntry[]): AnnualReportData {
  return {
    year,
    totalMovies: yearEntries.length,
    averageRating: computeAverageRating(yearEntries),
    favoriteGenre: calculateFavoriteGenre(yearEntries),
    topMovies: getTopRatedMovies(yearEntries, 3),
    ratingDistribution: computeRatingDistribution(
      yearEntries.map(({ userMovie }) => userMovie.rating)
    ),
  };
}
