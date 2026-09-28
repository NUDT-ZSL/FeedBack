import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserMovie } from '@/types';
import moviesData from '@/data/movies.json';
import { computeRatingDistribution } from '@/modules/stats/ratingStats';

const USER_MOVIES_KEY = 'cinecollect_user_movies';

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
  };
}

function seedUserMovies(userMovies: UserMovie[]) {
  const mock = createLocalStorageMock();
  mock.setItem(USER_MOVIES_KEY, JSON.stringify(userMovies));
  vi.stubGlobal('localStorage', mock);
}

async function importManagers() {
  const [{ movieManager }, { reviewManager }, { reportGenerator }] = await Promise.all([
    import('@/modules/movies/MovieManager'),
    import('@/modules/reviews/ReviewManager'),
    import('@/modules/reports/ReportGenerator'),
  ]);
  return { movieManager, reviewManager, reportGenerator };
}

function um(movieId: string, rating: number, addedAt: string): UserMovie {
  return { movieId, status: 'watched', rating, addedAt };
}

function sumCounts(distribution: { count: number }[]): number {
  return distribution.reduce((sum, item) => sum + item.count, 0);
}

const movieIds = (moviesData as { id: string }[]).map((m) => m.id);

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('空数据', () => {
  it('年度报告与短评分布均为空口径，且互相对得上', async () => {
    seedUserMovies([]);
    const { reviewManager, reportGenerator } = await importManagers();

    const report = reportGenerator.generateAnnualReport(2024);
    expect(report.totalMovies).toBe(0);
    expect(report.ratedCount).toBe(0);
    expect(report.averageRating).toBe(0);
    expect(report.favoriteGenre).toBe('-');
    expect(report.topMovies).toEqual([]);
    expect(sumCounts(report.ratingDistribution)).toBe(0);

    expect(reviewManager.getRatingDistribution()).toEqual(report.ratingDistribution);
    expect(reportGenerator.getAvailableYears()).toEqual([]);
    expect(reportGenerator.getTotalWatchedMovies()).toBe(0);
    expect(reportGenerator.getOverallAverageRating()).toBe(0);
  });
});

describe('单条数据', () => {
  it('未评分条目计入总数与「0分」桶，不计入平均分', async () => {
    seedUserMovies([um(movieIds[0], 0, '2024-06-01T12:00:00.000Z')]);
    const { reviewManager, reportGenerator } = await importManagers();

    const report = reportGenerator.generateAnnualReport(2024);
    expect(report.totalMovies).toBe(1);
    expect(report.ratedCount).toBe(0);
    expect(report.averageRating).toBe(0);
    expect(report.topMovies).toEqual([]);
    expect(sumCounts(report.ratingDistribution)).toBe(report.totalMovies);
    expect(report.ratingDistribution[0]).toEqual({ range: '0分', count: 1 });

    expect(reviewManager.getRatingDistribution()).toEqual(report.ratingDistribution);
  });
});

describe('边界与小数评分', () => {
  it('0/10/小数评分归属唯一，两条链路分布一致', async () => {
    const ratings = [0, 1, 2, 2.5, 4, 5, 6.5, 8, 9, 10];
    seedUserMovies(
      ratings.map((rating, i) => um(movieIds[i], rating, '2024-06-01T12:00:00.000Z'))
    );
    const { reviewManager, reportGenerator } = await importManagers();

    const report = reportGenerator.generateAnnualReport(2024);
    expect(report.totalMovies).toBe(ratings.length);
    expect(report.ratedCount).toBe(ratings.length - 1);
    // 区间计数之和 = 参与统计的条目数
    expect(sumCounts(report.ratingDistribution)).toBe(report.totalMovies);
    expect(report.ratingDistribution.map((d) => d.count)).toEqual([1, 2, 2, 1, 2, 2]);

    // 平均分只对已评分条目：(1+2+2.5+4+5+6.5+8+9+10)/9 = 5.3
    expect(report.averageRating).toBe(5.3);

    // 高分影片只含已评分条目，按评分降序
    expect(report.topMovies.map((m) => m.id)).toEqual([
      movieIds[9],
      movieIds[8],
      movieIds[7],
    ]);

    // 短评分布与年度报告分布同口径
    expect(reviewManager.getRatingDistribution()).toEqual(report.ratingDistribution);
    expect(reviewManager.getRatingDistribution()).toEqual(computeRatingDistribution(ratings));

    // 最爱类型来自当年全部收藏条目
    const genresOf = (id: string) =>
      (moviesData as { id: string; genres: string[] }[]).find((m) => m.id === id)!.genres;
    const genreCount: Record<string, number> = {};
    movieIds.slice(0, ratings.length).forEach((id) => {
      genresOf(id).forEach((g) => {
        genreCount[g] = (genreCount[g] || 0) + 1;
      });
    });
    const expectedGenre = Object.entries(genreCount).sort((a, b) => b[1] - a[1])[0][0];
    expect(report.favoriteGenre).toBe(expectedGenre);
  });
});

describe('跨年重复收藏', () => {
  it('同一影片只计一次并归属最早收藏年份，两处口径一致', async () => {
    // 存储层出现同一影片两条记录（模拟不同来源数据合并）
    seedUserMovies([
      um(movieIds[0], 8, '2024-02-01T12:00:00.000Z'),
      um(movieIds[0], 8, '2023-07-01T12:00:00.000Z'),
      um(movieIds[1], 6, '2024-05-01T12:00:00.000Z'),
    ]);
    const { reviewManager, reportGenerator } = await importManagers();

    const report2023 = reportGenerator.generateAnnualReport(2023);
    const report2024 = reportGenerator.generateAnnualReport(2024);

    expect(report2023.totalMovies).toBe(1);
    expect(report2024.totalMovies).toBe(1);
    // 同一影片不会在两个年份被重复计入
    expect(report2023.totalMovies + report2024.totalMovies).toBe(2);
    expect(report2023.ratingDistribution).toEqual(computeRatingDistribution([8]));
    expect(report2024.ratingDistribution).toEqual(computeRatingDistribution([6]));

    // 短评分布对同一影片也只计一次
    const distribution = reviewManager.getRatingDistribution();
    expect(sumCounts(distribution)).toBe(2);
    expect(distribution).toEqual(computeRatingDistribution([8, 6]));

    expect(reportGenerator.getAvailableYears()).toEqual([2024, 2023]);
    expect(reportGenerator.getTotalWatchedMovies()).toBe(2);
    expect(reportGenerator.getOverallAverageRating()).toBe(7);
  });
});

describe('收藏状态不影响统计', () => {
  it('want_to_watch / watched / rewatched 均计入', async () => {
    const seeded: UserMovie[] = [
      { movieId: movieIds[0], status: 'want_to_watch', rating: 0, addedAt: '2024-03-01T12:00:00.000Z' },
      { movieId: movieIds[1], status: 'watched', rating: 7, addedAt: '2024-04-01T12:00:00.000Z' },
      { movieId: movieIds[2], status: 'rewatched', rating: 9, addedAt: '2024-05-01T12:00:00.000Z' },
    ];
    seedUserMovies(seeded);
    const { reviewManager, reportGenerator } = await importManagers();

    const report = reportGenerator.generateAnnualReport(2024);
    expect(report.totalMovies).toBe(3);
    expect(report.ratedCount).toBe(2);
    expect(report.averageRating).toBe(8);
    expect(sumCounts(report.ratingDistribution)).toBe(3);
    expect(reviewManager.getRatingDistribution()).toEqual(report.ratingDistribution);
  });
});
