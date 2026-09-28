import { describe, expect, it } from 'vitest';
import type { Movie, UserMovie } from '@/types';
import {
  RATING_BUCKET_LABELS,
  compareAddedAt,
  computeAverageRating,
  computeRatingDistribution,
  dedupeUserMovies,
  filterEntriesByYear,
  getRatingBucketIndex,
  isRated,
  isValidRating,
} from '@/modules/stats/ratingStats';

function sumCounts(distribution: { count: number }[]): number {
  return distribution.reduce((sum, item) => sum + item.count, 0);
}

describe('isValidRating / isRated', () => {
  it('接受 [0,10] 内的有限数值（含小数）', () => {
    [0, 1, 5, 10, 0.5, 2.5, 9.9].forEach((r) => expect(isValidRating(r)).toBe(true));
  });

  it('拒绝越界与非数值', () => {
    [-0.1, -1, 10.1, 11, NaN, Infinity, -Infinity, '8', undefined, null].forEach((r) =>
      expect(isValidRating(r)).toBe(false)
    );
  });

  it('评分 0 视为未评分', () => {
    expect(isRated({ rating: 0 })).toBe(false);
    expect(isRated({ rating: 0.5 })).toBe(true);
    expect(isRated({ rating: 10 })).toBe(true);
    expect(isRated({ rating: NaN })).toBe(false);
  });
});

describe('getRatingBucketIndex 边界归属', () => {
  it('整数边界归属唯一', () => {
    const expected: [number, number][] = [
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 2],
      [5, 3],
      [6, 3],
      [7, 4],
      [8, 4],
      [9, 5],
      [10, 5],
    ];
    expected.forEach(([rating, bucket]) => {
      expect(getRatingBucketIndex(rating)).toBe(bucket);
    });
  });

  it('小数评分归属唯一且不遗漏', () => {
    const expected: [number, number][] = [
      [0.1, 1],
      [0.5, 1],
      [1.5, 1],
      [2.5, 2],
      [3.5, 2],
      [4.5, 3],
      [5.5, 3],
      [6.5, 4],
      [7.5, 4],
      [8.5, 5],
      [9.9, 5],
    ];
    expected.forEach(([rating, bucket]) => {
      expect(getRatingBucketIndex(rating)).toBe(bucket);
    });
  });

  it('非法评分返回 -1', () => {
    [-1, 10.5, 11, NaN, Infinity].forEach((r) => {
      expect(getRatingBucketIndex(r)).toBe(-1);
    });
  });
});

describe('computeRatingDistribution', () => {
  it('空数据：六个区间全为 0，计数之和为 0', () => {
    const distribution = computeRatingDistribution([]);
    expect(distribution.map((d) => d.range)).toEqual([...RATING_BUCKET_LABELS]);
    expect(sumCounts(distribution)).toBe(0);
  });

  it('单条数据：计数之和为 1', () => {
    const distribution = computeRatingDistribution([7]);
    expect(sumCounts(distribution)).toBe(1);
    expect(distribution[4]).toEqual({ range: '7-8分', count: 1 });
  });

  it('混合评分：计数之和等于有效评分数，非法评分被剔除', () => {
    const ratings = [0, 1, 2, 2.5, 5, 6.5, 8, 9, 10, 10, -1, 11, NaN];
    const distribution = computeRatingDistribution(ratings);
    expect(sumCounts(distribution)).toBe(10);
    expect(distribution.map((d) => d.count)).toEqual([1, 2, 1, 1, 2, 3]);
  });
});

describe('computeAverageRating', () => {
  it('空数据与全未评分返回 0', () => {
    expect(computeAverageRating([])).toBe(0);
    expect(computeAverageRating([{ rating: 0 }, { rating: 0 }])).toBe(0);
  });

  it('只对已评分条目求平均，保留 1 位小数', () => {
    expect(computeAverageRating([{ rating: 0 }, { rating: 8 }, { rating: 9 }])).toBe(8.5);
    expect(computeAverageRating([{ rating: 7 }, { rating: 8 }, { rating: 8 }])).toBe(7.7);
  });
});

describe('dedupeUserMovies / compareAddedAt', () => {
  it('同一影片保留最早收藏时间', () => {
    const result = dedupeUserMovies([
      { movieId: '1', rating: 8, addedAt: '2024-03-01T00:00:00.000Z' },
      { movieId: '1', rating: 9, addedAt: '2023-06-01T00:00:00.000Z' },
      { movieId: '2', rating: 7, addedAt: '2024-01-01T00:00:00.000Z' },
    ]);
    expect(result).toHaveLength(2);
    const kept = result.find((um) => um.movieId === '1');
    expect(kept?.addedAt).toBe('2023-06-01T00:00:00.000Z');
    expect(kept?.rating).toBe(9);
  });

  it('非法日期劣后于有效日期', () => {
    expect(compareAddedAt('not-a-date', '2023-01-01T00:00:00.000Z')).toBeGreaterThan(0);
    const result = dedupeUserMovies([
      { movieId: '1', rating: 8, addedAt: 'not-a-date' },
      { movieId: '1', rating: 8, addedAt: '2023-01-01T00:00:00.000Z' },
    ]);
    expect(result[0].addedAt).toBe('2023-01-01T00:00:00.000Z');
  });
});

describe('filterEntriesByYear', () => {
  const movie = (id: string): Movie => ({
    id,
    title: `电影${id}`,
    director: '导演',
    year: 2000,
    posterUrl: '',
    genres: ['剧情'],
    synopsis: '',
  });
  const userMovie = (movieId: string, rating: number, addedAt: string): UserMovie => ({
    movieId,
    status: 'watched',
    rating,
    addedAt,
  });

  it('跨年重复收藏只计入最早收藏年份一次', () => {
    const entries = [
      { movie: movie('1'), userMovie: userMovie('1', 8, '2024-02-01T00:00:00.000Z') },
      { movie: movie('1'), userMovie: userMovie('1', 8, '2023-07-01T00:00:00.000Z') },
      { movie: movie('2'), userMovie: userMovie('2', 6, '2024-05-01T00:00:00.000Z') },
    ];
    const y2023 = filterEntriesByYear(entries, 2023);
    const y2024 = filterEntriesByYear(entries, 2024);
    expect(y2023.map((e) => e.userMovie.movieId)).toEqual(['1']);
    expect(y2024.map((e) => e.userMovie.movieId)).toEqual(['2']);
  });

  it('空数据返回空数组', () => {
    expect(filterEntriesByYear([], 2024)).toEqual([]);
  });
});
