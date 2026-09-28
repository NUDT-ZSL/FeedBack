import type { Movie, UserMovie, RatingDistributionItem } from '@/types';

/**
 * 统一评分统计口径（ReviewManager 与 ReportGenerator 共用本模块，保证两处结果可互相核对）：
 *
 * 1. 计入统计的条目：所有收藏条目，不区分 WatchStatus（want_to_watch / watched / rewatched 均计入）。
 * 2. 评分有效范围：[0, 10] 内的有限数值；非法评分（NaN、Infinity、越界）不参与评分相关统计。
 * 3. 评分 0 表示「未评分」：计入收藏总数与评分分布的「0分」桶，但不计入平均分与高分影片。
 * 4. 评分分布覆盖 [0, 10] 全部取值，区间左开右闭、归属唯一：
 *    0分 | (0,2] | (2,4] | (4,6] | (6,8] | (8,10]
 *    小数评分按同一规则归属，区间计数之和等于参与统计的有效评分条目数。
 * 5. 同一影片（movieId）重复收藏时按最早 addedAt 保留一条，年度报告按该收藏时间归属年份，
 *    跨年重复收藏不会被重复计入，也不因数据来源不同产生偏差。
 */

export const RATING_BUCKET_LABELS = [
  '0分',
  '1-2分',
  '3-4分',
  '5-6分',
  '7-8分',
  '9-10分',
] as const;

export interface UserMovieLike {
  movieId: string;
  rating: number;
  addedAt: string;
}

export interface MovieEntry {
  movie: Movie;
  userMovie: UserMovie;
}

/** 评分是否为 [0, 10] 内的有限数值 */
export function isValidRating(rating: unknown): rating is number {
  return typeof rating === 'number' && Number.isFinite(rating) && rating >= 0 && rating <= 10;
}

/** 是否已评分（评分有效且大于 0；0 表示未评分） */
export function isRated(userMovie: { rating: number }): boolean {
  return isValidRating(userMovie.rating) && userMovie.rating > 0;
}

/**
 * 评分归属的区间下标；非法评分返回 -1。
 * 边界规则：0 -> 0；(0,2] -> 1；(2,4] -> 2；(4,6] -> 3；(6,8] -> 4；(8,10] -> 5。
 */
export function getRatingBucketIndex(rating: number): number {
  if (!isValidRating(rating)) {
    return -1;
  }
  if (rating === 0) {
    return 0;
  }
  return Math.min(Math.ceil(rating / 2), RATING_BUCKET_LABELS.length - 1);
}

/** 由评分列表计算分布；非法评分被跳过，计数之和等于有效评分数 */
export function computeRatingDistribution(ratings: number[]): RatingDistributionItem[] {
  const distribution: RatingDistributionItem[] = RATING_BUCKET_LABELS.map((range) => ({
    range,
    count: 0,
  }));

  ratings.forEach((rating) => {
    const index = getRatingBucketIndex(rating);
    if (index >= 0) {
      distribution[index].count++;
    }
  });

  return distribution;
}

/** 已评分条目的平均分（保留 1 位小数）；无已评分条目时返回 0 */
export function computeAverageRating(userMovies: { rating: number }[]): number {
  const rated = userMovies.filter(isRated);
  if (rated.length === 0) {
    return 0;
  }
  const sum = rated.reduce((acc, userMovie) => acc + userMovie.rating, 0);
  return Math.round((sum / rated.length) * 10) / 10;
}

/** addedAt 比较：非法日期视为无穷大，保证有效日期的条目优先保留 */
export function compareAddedAt(a: string, b: string): number {
  const timeA = new Date(a).getTime();
  const timeB = new Date(b).getTime();
  const safeA = Number.isNaN(timeA) ? Number.POSITIVE_INFINITY : timeA;
  const safeB = Number.isNaN(timeB) ? Number.POSITIVE_INFINITY : timeB;
  return safeA - safeB;
}

/** 按 movieId 去重，保留 addedAt 最早的一条（跨年重复收藏归属首次收藏年份） */
export function dedupeUserMovies<T extends UserMovieLike>(userMovies: T[]): T[] {
  const byMovieId = new Map<string, T>();
  userMovies.forEach((userMovie) => {
    const existing = byMovieId.get(userMovie.movieId);
    if (!existing || compareAddedAt(userMovie.addedAt, existing.addedAt) < 0) {
      byMovieId.set(userMovie.movieId, userMovie);
    }
  });
  return Array.from(byMovieId.values());
}

/** 收藏条目按 movieId 去重后，过滤出 addedAt 归属指定年份的条目 */
export function filterEntriesByYear(entries: MovieEntry[], year: number): MovieEntry[] {
  const byMovieId = new Map<string, MovieEntry>();
  entries.forEach((entry) => {
    const existing = byMovieId.get(entry.userMovie.movieId);
    if (!existing || compareAddedAt(entry.userMovie.addedAt, existing.userMovie.addedAt) < 0) {
      byMovieId.set(entry.userMovie.movieId, entry);
    }
  });
  return Array.from(byMovieId.values()).filter(
    (entry) => new Date(entry.userMovie.addedAt).getFullYear() === year
  );
}
