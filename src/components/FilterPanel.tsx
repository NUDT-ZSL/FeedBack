import React, { useMemo } from 'react';
import { useMovies } from '../context/MovieContext';
import type { FilterState } from '../types';

export const FilterPanel: React.FC = () => {
  const { filter, setFilter, movies } = useMovies();

  const availableYears = useMemo(() => {
    const years = new Set(movies.map((m) => m.year).filter(Boolean));
    return Array.from(years).sort((a, b) => b - a);
  }, [movies]);

  const updateFilter = (patch: Partial<FilterState>) => {
    setFilter({ ...filter, ...patch });
  };

  return (
    <div className="filter-panel">
      <div className="filter-group">
        <label>年份</label>
        <select
          value={filter.year ?? ''}
          onChange={(e) => updateFilter({ year: e.target.value ? Number(e.target.value) : null })}
          className="filter-select"
        >
          <option value="">全部</option>
          {availableYears.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      <div className="filter-group">
        <label>最低评分</label>
        <select
          value={filter.minRating ?? ''}
          onChange={(e) => updateFilter({ minRating: e.target.value ? Number(e.target.value) : null })}
          className="filter-select"
        >
          <option value="">全部</option>
          {[0, 2, 4, 6, 8, 10].map((r) => (
            <option key={r} value={r}>
              {r} 分以上
            </option>
          ))}
        </select>
      </div>
      <div className="filter-group">
        <label>观看状态</label>
        <select
          value={filter.watched === null ? '' : String(filter.watched)}
          onChange={(e) => {
            const v = e.target.value;
            updateFilter({ watched: v === '' ? null : v === 'true' });
          }}
          className="filter-select"
        >
          <option value="">全部</option>
          <option value="true">已看</option>
          <option value="false">未看</option>
        </select>
      </div>
      <div className="filter-group">
        <label>排序方式</label>
        <select
          value={`${filter.sortBy}-${filter.sortOrder}`}
          onChange={(e) => {
            const [sortBy, sortOrder] = e.target.value.split('-') as [FilterState['sortBy'], FilterState['sortOrder']];
            updateFilter({ sortBy, sortOrder });
          }}
          className="filter-select"
        >
          <option value="addedAt-desc">添加时间（新→旧）</option>
          <option value="addedAt-asc">添加时间（旧→新）</option>
          <option value="rating-desc">评分（高→低）</option>
          <option value="rating-asc">评分（低→高）</option>
        </select>
      </div>
    </div>
  );
};
