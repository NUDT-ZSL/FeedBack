import { describe, it, expect } from 'vitest';
import type { Movie, UserMovie } from '@/types';
import {
  RATING_BUCKETS,
  assignRatingBucket,
  computeAnnualReportData,
  computeAverageRating,
  computeRatingDistribution,
  dedupeEntriesByMovieId,
  filterEntriesByYear,
  isRated,
  isValidRating,
  type UserMovieEntry,
} from '@/modules/stats/ratingStats';

function makeMovie(id: string, genres: string[] = ['剧情']): Movie {
  return {
    id,
    title: `电影${id}`,
    director: '导演',
    year: 2000,
    posterUrl: '',
    genres,
    synopsis: '',
  };
}

function makeEntry(
  movieId: string,
  rating: number,
  addedAt: string,
  genres: string[] = ['剧情']
): UserMovieEntry {
  const userMovie: UserMovie = {
    movieId,
    status: 'watched',
    rating,
    addedAt,
  };
  return { movie: makeMovie(movieId, genres), userMovie };
}

function distributionSum(distribution: { count: number }[]): number {
  return distribution.reduce((sum, item) => sum + item.count, 0);
}

describe('isValidRating / isRated', () => {
  it('接受 [0,10] 内的整数与小数', () => {
    [0, 1, 5, 9.5, 10].forEach((r) => expect(isValidRating(r)).toBe(true));
  });

  it('拒绝越界值、NaN、Infinity 与非数值', () => {
    [-0.1, 10.1, NaN, Infinity, -Infinity, '5', undefined, null].forEach((r) =>
      expect(isValidRating(r)).toBe(false)
    );
  });

  it('评分 0 视为未评分', () => {
    expect(isRated(0)).toBe(false);
    expect(isRated(0.5)).toBe(true);
    expect(isRated(10)).toBe(true);
  });
});

describe('assignRatingBucket 边界与小数归属', () => {
  it('区间边界归属唯一：左闭右开，末段含 10', () => {
    expect(assignRatingBucket(0)).toBe(0);
    expect(assignRatingBucket(1.999)).toBe(0);
    expect(assignRatingBucket(2)).toBe(1);
    expect(assignRatingBucket(4)).toBe(2);
    expect(assignRatingBucket(6)).toBe(3);
    expect(assignRatingBucket(8)).toBe(4);
    expect(assignRatingBucket(10)).toBe(4);
  });

  it('小数评分不遗漏', () => {
    expect(assignRatingBucket(0.5)).toBe(0);
    expect(assignRatingBucket(2.5)).toBe(1);
    expect(assignRatingBucket(7.5)).toBe(3);
    expect(assignRatingBucket(9.9)).toBe(4);
  });

  it('非法评分返回 -1', () => {
    expect(assignRatingBucket(-1)).toBe(-1);
    expect(assignRatingBucket(11)).toBe(-1);
    expect(assignRatingBucket(NaN)).toBe(-1);
  });

  it('0~10 全量取值（步长 0.1）均可归入唯一区间', () => {
    for (let t = 0; t <= 100; t++) {
      const rating = t / 10;
      const index = assignRatingBucket(rating);
      expect(index).toBeGreaterThanOrEqual(0);
      const bucket = RATING_BUCKETS[index];
      expect(rating).toBeGreaterThanOrEqual(bucket.min);
      if (bucket.includeMax) {
        expect(rating).toBeLessThanOrEqual(bucket.max);
      } else {
        expect(rating).toBeLessThan(bucket.max);
      }
    }
  });
});

describe('computeRatingDistribution', () => {
  it('空数据返回全 0 分布', () => {
    const dist = computeRatingDistribution([]);
    expect(dist).toHaveLength(RATING_BUCKETS.length);
    expect(distributionSum(dist)).toBe(0);
  });

  it('单条数据计数之和为 1', () => {
    expect(distributionSum(computeRatingDistribution([7]))).toBe(1);
  });

  it('计数之和等于合法评分数，非法评分被剔除', () => {
    const ratings = [0, 2, 2.5, 5, 10, 9.9, -1, 11, NaN];
    const dist = computeRatingDistribution(ratings);
    expect(distributionSum(dist)).toBe(6);
    expect(dist[0].count).toBe(1); // 0
    expect(dist[1].count).toBe(2); // 2, 2.5
    expect(dist[2].count).toBe(1); // 5
    expect(dist[4].count).toBe(2); // 10, 9.9
  });
});

describe('dedupeEntriesByMovieId / filterEntriesByYear', () => {
  it('同一影片重复收藏只保留最早一条', () => {
    const entries = [
      makeEntry('m1', 8, '2025-06-01T00:00:00.000Z'),
      makeEntry('m1', 3, '2025-03-01T00:00:00.000Z'),
    ];
    const deduped = dedupeEntriesByMovieId(entries);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].userMovie.rating).toBe(3);
  });

  it('按收藏时间归属年份，跨年重复收藏在各年各计一次', () => {
    const entries = [
      makeEntry('m1', 8, '2024-12-31T12:00:00.000Z'),
      makeEntry('m1', 9, '2025-01-01T12:00:00.000Z'),
      makeEntry('m2', 6, '2025-05-01T00:00:00.000Z'),
    ];
    const y2024 = filterEntriesByYear(entries, 2024);
    const y2025 = filterEntriesByYear(entries, 2025);
    expect(y2024.map((e) => e.userMovie.movieId)).toEqual(['m1']);
    expect(y2025.map((e) => e.userMovie.movieId).sort()).toEqual(['m1', 'm2']);
  });

  it('同一年内重复收藏去重后只计一次', () => {
    const entries = [
      makeEntry('m1', 8, '2025-01-01T00:00:00.000Z'),
      makeEntry('m1', 9, '2025-11-01T00:00:00.000Z'),
    ];
    expect(filterEntriesByYear(entries, 2025)).toHaveLength(1);
  });
});

describe('computeAverageRating', () => {
  it('未评分（0 分）条目不参与平均分', () => {
    const entries = [makeEntry('m1', 8, '2025-01-01T00:00:00.000Z'), makeEntry('m2', 0, '2025-01-02T00:00:00.000Z')];
    expect(computeAverageRating(entries)).toBe(8);
  });

  it('全部未评分或空数据时平均分为 0', () => {
    expect(computeAverageRating([])).toBe(0);
    expect(computeAverageRating([makeEntry('m1', 0, '2025-01-01T00:00:00.000Z')])).toBe(0);
  });
});

describe('computeAnnualReportData 自洽性', () => {
  it('收藏总数含未评分条目，分布之和等于收藏总数', () => {
    const yearEntries = [
      makeEntry('m1', 10, '2025-01-01T00:00:00.000Z', ['科幻']),
      makeEntry('m2', 0, '2025-02-01T00:00:00.000Z', ['科幻']),
      makeEntry('m3', 6.5, '2025-03-01T00:00:00.000Z', ['剧情']),
    ];
    const report = computeAnnualReportData(2025, yearEntries);
    expect(report.totalMovies).toBe(3);
    expect(distributionSum(report.ratingDistribution)).toBe(report.totalMovies);
    expect(report.averageRating).toBe(8.3); // (10 + 6.5) / 2
    expect(report.favoriteGenre).toBe('科幻');
    expect(report.topMovies.map((m) => m.id)).toEqual(['m1', 'm3']);
  });

  it('空年份返回空报告', () => {
    const report = computeAnnualReportData(2025, []);
    expect(report.totalMovies).toBe(0);
    expect(report.averageRating).toBe(0);
    expect(report.favoriteGenre).toBe('-');
    expect(report.topMovies).toEqual([]);
    expect(distributionSum(report.ratingDistribution)).toBe(0);
  });
});
