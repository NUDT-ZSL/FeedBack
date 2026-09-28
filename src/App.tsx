import React, { useReducer, useMemo, useCallback, useEffect } from 'react';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import Gallery from './components/Gallery';
import PhotoModal from './components/PhotoModal';
import { initialPhotos } from './data/photos';
import { useDebounce } from './hooks/useDebounce';
import {
  createInitialState,
  portfolioReducer,
  selectAllTags,
  selectFilteredPhotos,
  selectTopPhotos,
  selectMaxLikes,
  selectSelectedPhoto,
} from './store/portfolio';
import type { Photo, SortType } from './types';

const App: React.FC = () => {
  // 单一数据源：照片集合、筛选条件、排序方式、模态框目标、侧边栏状态
  const [state, dispatch] = useReducer(portfolioReducer, initialPhotos, createInitialState);
  const { photos, selectedTags, sortBy, searchQuery, selectedPhotoId, sidebarOpen } = state;

  const debouncedSearch = useDebounce(searchQuery, 200);

  // 所有派生视图都从同一份状态派生，筛选/排序/点赞变化时各视图天然同步
  const allTags = useMemo(() => selectAllTags(photos), [photos]);

  const filteredPhotos = useMemo(
    () => selectFilteredPhotos(photos, selectedTags, debouncedSearch, sortBy),
    [photos, selectedTags, debouncedSearch, sortBy],
  );

  const topPhotos = useMemo(() => selectTopPhotos(photos), [photos]);
  const maxLikes = useMemo(() => selectMaxLikes(photos), [photos]);

  // 模态框只持有 id，展示对象从 photos 实时派生，打开期间的点赞会同步进来
  const selectedPhoto = useMemo(
    () => selectSelectedPhoto(photos, selectedPhotoId),
    [photos, selectedPhotoId],
  );

  const handleLike = useCallback((id: number) => {
    dispatch({ type: 'LIKE_PHOTO', id });
  }, []);

  const handleTagToggle = useCallback((tag: string) => {
    dispatch({ type: 'TOGGLE_TAG', tag });
  }, []);

  const handlePhotoClick = useCallback((photo: Photo) => {
    dispatch({ type: 'OPEN_PHOTO', id: photo.id });
  }, []);

  const handleCloseModal = useCallback(() => {
    dispatch({ type: 'CLOSE_PHOTO' });
  }, []);

  const handleToggleSidebar = useCallback(() => {
    dispatch({ type: 'TOGGLE_SIDEBAR' });
  }, []);

  const handleSearchChange = useCallback((query: string) => {
    dispatch({ type: 'SET_SEARCH', query });
  }, []);

  const handleSortChange = useCallback((sort: SortType) => {
    dispatch({ type: 'SET_SORT', sortBy: sort });
  }, []);

  const handleRankingClick = useCallback((photo: Photo) => {
    dispatch({ type: 'OPEN_PHOTO', id: photo.id });
    if (window.innerWidth <= 768) {
      dispatch({ type: 'CLOSE_SIDEBAR' });
    }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768) {
        dispatch({ type: 'CLOSE_SIDEBAR' });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="app-container">
      <Navbar
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        sortBy={sortBy}
        onSortChange={handleSortChange}
        onToggleSidebar={handleToggleSidebar}
      />
      <div className="main-content">
        <Sidebar
          topPhotos={topPhotos}
          maxLikes={maxLikes}
          allTags={allTags}
          selectedTags={selectedTags}
          onTagToggle={handleTagToggle}
          onRankingClick={handleRankingClick}
          isOpen={sidebarOpen}
        />
        <Gallery
          photos={filteredPhotos}
          onLike={handleLike}
          onPhotoClick={handlePhotoClick}
        />
      </div>
      <PhotoModal photo={selectedPhoto} onClose={handleCloseModal} />
    </div>
  );
};

export default App;
