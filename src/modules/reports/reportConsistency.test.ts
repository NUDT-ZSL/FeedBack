import { describe, it, expect } from 'vitest';
import type { Movie, UserMovie, WatchStatus } from '@/types';
import { reviewManager } from '@/modules/reviews/ReviewManager';
import { reportGenerator } from '@/modules/reports/ReportGenerator';
import type { UserMovieEntry } from '@/modules/stats/ratingStats';

let seq = 0;
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
  status: WatchStatus = 'watched',
  genres: string[] = ['剧情']
): UserMovieEntry {
  seq += 1;
  const userMovie: UserMovie = { movieId, status, rating, addedAt };
  return { movie: makeMovie(`${movieId}_${seq}`, genres), userMovie };
}

function sum(distribution: { count: number }[]): number {
  return distribution.reduce((acc, item) => acc + item.count, 0);
}

describe('ReviewManager 与 ReportGenerator 口径一致', () => {
  it('同一批数据：两处评分分布区间一致，且总数可互相核对', () => {
    const entries = [
      makeEntry('a', 0, '2025-01-01T12:00:00.000Z'),
      makeEntry('b', 2, '2025-02-01T12:00:00.000Z'),
      makeEntry('c', 2.5, '2025-03-01T12:00:00.000Z'),
      makeEntry('d', 10, '2025-04-01T12:00:00.000Z'),
      makeEntry('e', 9.9, '2025-05-01T12:00:00.000Z'),
    ];

    const reviewDist = reviewManager.getRatingDistribution(entries);
    const report = reportGenerator.generateAnnualReport(2025, entries);

    expect(reviewDist.map((d) => d.range)).toEqual(
      report.ratingDistribution.map((d) => d.range)
    );
    // 短评侧分布针对全量收藏；报告侧针对当年收藏。本数据全部为 2025 年，应完全相等。
    expect(reviewDist).toEqual(report.ratingDistribution);
    expect(sum(reviewDist)).toBe(report.totalMovies);
    expect(report.totalMovies).toBe(5);
  });

  it('观看状态不影响计入统计', () => {
    const entries = [
      makeEntry('a', 8, '2025-01-01T12:00:00.000Z', 'want_to_watch'),
      makeEntry('b', 6, '2025-01-02T12:00:00.000Z', 'watched'),
      makeEntry('c', 4, '2025-01-03T12:00:00.000Z', 'rewatched'),
    ];
    const report = reportGenerator.generateAnnualReport(2025, entries);
    expect(report.totalMovies).toBe(3);
    expect(sum(report.ratingDistribution)).toBe(3);
  });

  it('跨年重复收藏：各年分别计入，同年内去重', () => {
    const entries = [
      makeEntry('a', 8, '2024-06-01T12:00:00.000Z'),
      makeEntry('a', 9, '2025-06-01T12:00:00.000Z'),
      makeEntry('a', 7, '2025-09-01T12:00:00.000Z'), // 与上一条同年同片，应去重
      makeEntry('b', 5, '2025-03-01T12:00:00.000Z'),
    ];

    const report2024 = reportGenerator.generateAnnualReport(2024, entries);
    const report2025 = reportGenerator.generateAnnualReport(2025, entries);

    expect(report2024.totalMovies).toBe(1);
    expect(report2025.totalMovies).toBe(2);
    expect(sum(report2025.ratingDistribution)).toBe(2);
    // 同年去重保留最早收藏记录（rating 9）
    expect(report2025.averageRating).toBe(7); // (9 + 5) / 2
  });

  it('空数据：报告与分布均为空口径', () => {
    const report = reportGenerator.generateAnnualReport(2030, []);
    expect(report.totalMovies).toBe(0);
    expect(report.averageRating).toBe(0);
    expect(report.favoriteGenre).toBe('-');
    expect(report.topMovies).toEqual([]);
    expect(sum(report.ratingDistribution)).toBe(0);
    expect(sum(reviewManager.getRatingDistribution([]))).toBe(0);
  });

  it('单条未评分数据：计入总数与分布，不计入平均分与高分影片', () => {
    const entries = [makeEntry('a', 0, '2025-01-01T12:00:00.000Z')];
    const report = reportGenerator.generateAnnualReport(2025, entries);
    expect(report.totalMovies).toBe(1);
    expect(report.averageRating).toBe(0);
    expect(report.topMovies).toEqual([]);
    expect(report.ratingDistribution[0].count).toBe(1);
    expect(sum(report.ratingDistribution)).toBe(1);
  });

  it('整体已评分数与整体平均分口径', () => {
    const entries = [
      makeEntry('a', 8, '2024-01-01T12:00:00.000Z'),
      makeEntry('b', 0, '2024-02-01T12:00:00.000Z'),
      makeEntry('c', 6, '2025-01-01T12:00:00.000Z'),
    ];
    expect(reportGenerator.getTotalWatchedMovies(entries)).toBe(2);
    expect(reportGenerator.getOverallAverageRating(entries)).toBe(7);
    expect(reportGenerator.getAvailableYears(entries)).toEqual([2025, 2024]);
  });
});
