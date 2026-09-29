import type { AnnualReportData } from '@/types';
import { movieManager } from '@/modules/movies/MovieManager';
import {
  computeAnnualReportData,
  computeAverageRating,
  dedupeEntriesByMovieId,
  filterEntriesByYear,
  isRated,
  type UserMovieEntry,
} from '@/modules/stats/ratingStats';

/**
 * 年度报告生成器。统计口径与 ReviewManager 共用 ratingStats 模块：
 * - 收藏总数：当年全部收藏条目（含未评分，状态不影响计入），同年同片去重；
 * - 平均分 / 高分影片：仅已评分（rating > 0）条目参与；
 * - 评分分布：覆盖 0~10 全部取值，区间计数之和等于收藏总数。
 */
class ReportGenerator {
  private static instance: ReportGenerator;

  private constructor() {}

  public static getInstance(): ReportGenerator {
    if (!ReportGenerator.instance) {
      ReportGenerator.instance = new ReportGenerator();
    }
    return ReportGenerator.instance;
  }

  public getAvailableYears(source?: UserMovieEntry[]): number[] {
    const entries = source ?? movieManager.getAllUserMovies();
    const years = new Set<number>();

    entries.forEach(({ userMovie }) => {
      years.add(new Date(userMovie.addedAt).getFullYear());
    });

    return Array.from(years).sort((a, b) => b - a);
  }

  /**
   * 生成年度报告。可注入数据源（默认取 MovieManager 全量收藏），
   * 便于离线构造数据验证。
   */
  public generateAnnualReport(year: number, source?: UserMovieEntry[]): AnnualReportData {
    const entries = source ?? movieManager.getAllUserMovies();
    const yearEntries = filterEntriesByYear(entries, year);
    return computeAnnualReportData(year, yearEntries);
  }

  /** 已评分影片总数（按 movieId 去重，未评分不计入） */
  public getTotalWatchedMovies(source?: UserMovieEntry[]): number {
    const entries = dedupeEntriesByMovieId(source ?? movieManager.getAllUserMovies());
    return entries.filter(({ userMovie }) => isRated(userMovie.rating)).length;
  }

  /** 全量收藏中已评分条目的平均分（未评分不参与） */
  public getOverallAverageRating(source?: UserMovieEntry[]): number {
    const entries = dedupeEntriesByMovieId(source ?? movieManager.getAllUserMovies());
    return computeAverageRating(entries);
  }
}

export const reportGenerator = ReportGenerator.getInstance();
export default ReportGenerator;
