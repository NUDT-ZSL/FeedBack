import React, { useState, useMemo, useCallback, useEffect } from 'react';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import Gallery from './components/Gallery';
import PhotoModal from './components/PhotoModal';
import { initialPhotos } from './data/photos';
import { sortByLikes, sortByDate } from './utils/sort';
import { useDebounce } from './hooks/useDebounce';
import type { Photo, SortType } from './types';

const App: React.FC = () => {
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortType>('likes');
  const [searchInput, setSearchInput] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const debouncedSearch = useDebounce(searchInput, 200);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    photos.forEach(photo => photo.tags.forEach(tag => tagSet.add(tag)));
    return Array.from(tagSet).sort();
  }, [photos]);

  const filteredPhotos = useMemo(() => {
    let result = [...photos];

    if (selectedTags.length > 0) {
      result = result.filter(photo =>
        selectedTags.some(tag => photo.tags.includes(tag))
      );
    }

    if (debouncedSearch.trim()) {
      const query = debouncedSearch.toLowerCase().trim();
      result = result.filter(photo =>
        photo.title.toLowerCase().includes(query)
      );
    }

    if (sortBy === 'likes') {
      result = sortByLikes(result);
    } else {
      result = sortByDate(result);
    }

    return result;
  }, [photos, selectedTags, sortBy, debouncedSearch]);

  const handleLike = useCallback((id: number) => {
    setPhotos(prev =>
      prev.map(photo =>
        photo.id === id ? { ...photo, likes: photo.likes + 1 } : photo
      )
    );
  }, []);

  const handleTagToggle = useCallback((tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  }, []);

  const handlePhotoClick = useCallback((photo: Photo) => {
    setSelectedPhoto(photo);
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedPhoto(null);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  const handleSearchChange = useCallback((query: string) => {
    setSearchInput(query);
  }, []);

  const handleSortChange = useCallback((sort: SortType) => {
    setSortBy(sort);
  }, []);

  const handleRankingClick = useCallback((photo: Photo) => {
    setSelectedPhoto(photo);
    if (window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="app-container">
      <Navbar
        searchQuery={searchInput}
        onSearchChange={handleSearchChange}
        sortBy={sortBy}
        onSortChange={handleSortChange}
        onToggleSidebar={handleToggleSidebar}
      />
      <div className="main-content">
        <Sidebar
          photos={photos}
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
