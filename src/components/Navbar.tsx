import React, { useCallback } from 'react';
import { Search, Menu } from 'lucide-react';
import type { SortType } from '../types';

interface NavbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortBy: SortType;
  onSortChange: (sort: SortType) => void;
  onToggleSidebar: () => void;
}

const Navbar: React.FC<NavbarProps> = ({
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
  onToggleSidebar,
}) => {
  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchChange(e.target.value);
  }, [onSearchChange]);

  const handleSort = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    onSortChange(e.target.value as SortType);
  }, [onSortChange]);

  return (
    <nav className="navbar">
      <h1 className="navbar-title">摄影集</h1>
      <div className="navbar-search">
        <Search size={18} />
        <input
          type="text"
          placeholder="搜索作品..."
          value={searchQuery}
          onChange={handleSearch}
        />
      </div>
      <div className="navbar-sort">
        <label htmlFor="sort-select">排序:</label>
        <select
          id="sort-select"
          value={sortBy}
          onChange={handleSort}
        >
          <option value="likes">按热度</option>
          <option value="date">按日期</option>
        </select>
      </div>
      <button className="hamburger-btn" onClick={onToggleSidebar} aria-label="菜单">
        <Menu size={24} />
      </button>
    </nav>
  );
};

export default React.memo(Navbar);
