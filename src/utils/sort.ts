import type { Photo } from '../types';

export const sortByLikes = (photos: Photo[]): Photo[] => {
  return [...photos].sort((a, b) => b.likes - a.likes);
};

export const sortByDate = (photos: Photo[]): Photo[] => {
  return [...photos].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

export const getTopPhotos = (photos: Photo[], count: number): Photo[] => {
  return sortByLikes(photos).slice(0, count);
};

export const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}年${month}月${day}日`;
};
