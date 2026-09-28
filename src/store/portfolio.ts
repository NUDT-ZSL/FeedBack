import type { Photo, SortType } from '../types';
import { sortByLikes, sortByDate, getTopPhotos } from '../utils/sort';

/**
 * 作品集单一数据源：照片集合、筛选条件、排序方式、模态框目标、侧边栏开关
 * 全部收敛到这一份状态中。所有视图（画廊、排行、模态框、标签集合）都通过
 * 下方的纯选择器从同一份状态派生，杜绝各模块各自维护派生数据导致的不一致。
 */

export const RANKING_COUNT = 5;

export interface PortfolioState {
  photos: Photo[];
  selectedTags: string[];
  sortBy: SortType;
  searchQuery: string;
  /** 只保存照片 id，模态框展示的照片始终从 photos 派生，保证是最新状态 */
  selectedPhotoId: number | null;
  sidebarOpen: boolean;
}

export type PortfolioAction =
  | { type: 'LIKE_PHOTO'; id: number }
  | { type: 'TOGGLE_TAG'; tag: string }
  | { type: 'SET_SORT'; sortBy: SortType }
  | { type: 'SET_SEARCH'; query: string }
  | { type: 'OPEN_PHOTO'; id: number }
  | { type: 'CLOSE_PHOTO' }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'CLOSE_SIDEBAR' };

export function createInitialState(photos: Photo[]): PortfolioState {
  return {
    photos,
    selectedTags: [],
    sortBy: 'likes',
    searchQuery: '',
    selectedPhotoId: null,
    sidebarOpen: false,
  };
}

export function portfolioReducer(
  state: PortfolioState,
  action: PortfolioAction,
): PortfolioState {
  switch (action.type) {
    case 'LIKE_PHOTO':
      return {
        ...state,
        photos: state.photos.map(photo =>
          photo.id === action.id ? { ...photo, likes: photo.likes + 1 } : photo,
        ),
      };
    case 'TOGGLE_TAG':
      return {
        ...state,
        selectedTags: state.selectedTags.includes(action.tag)
          ? state.selectedTags.filter(tag => tag !== action.tag)
          : [...state.selectedTags, action.tag],
      };
    case 'SET_SORT':
      return { ...state, sortBy: action.sortBy };
    case 'SET_SEARCH':
      return { ...state, searchQuery: action.query };
    case 'OPEN_PHOTO':
      return { ...state, selectedPhotoId: action.id };
    case 'CLOSE_PHOTO':
      return { ...state, selectedPhotoId: null };
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarOpen: !state.sidebarOpen };
    case 'CLOSE_SIDEBAR':
      return { ...state, sidebarOpen: false };
    default:
      return state;
  }
}

/* ---------------- 派生选择器（纯函数，所有视图共用） ---------------- */

/** 标签集合：从照片集合派生 */
export function selectAllTags(photos: Photo[]): string[] {
  const tagSet = new Set<string>();
  photos.forEach(photo => photo.tags.forEach(tag => tagSet.add(tag)));
  return Array.from(tagSet).sort();
}

/** 画廊数据：标签筛选 + 搜索 + 排序，作用于同一份照片集合 */
export function selectFilteredPhotos(
  photos: Photo[],
  selectedTags: string[],
  searchQuery: string,
  sortBy: SortType,
): Photo[] {
  let result = [...photos];

  if (selectedTags.length > 0) {
    result = result.filter(photo =>
      selectedTags.some(tag => photo.tags.includes(tag)),
    );
  }

  const query = searchQuery.trim().toLowerCase();
  if (query) {
    result = result.filter(photo => photo.title.toLowerCase().includes(query));
  }

  return sortBy === 'likes' ? sortByLikes(result) : sortByDate(result);
}

/** 热度排行：与画廊共用同一份照片集合，始终按热度取前 N */
export function selectTopPhotos(photos: Photo[]): Photo[] {
  return getTopPhotos(photos, RANKING_COUNT);
}

/** 排行进度条基准：全量照片的最大点赞数（空集合时返回 0，调用方需防除零） */
export function selectMaxLikes(photos: Photo[]): number {
  return photos.reduce((max, photo) => Math.max(max, photo.likes), 0);
}

/** 模态框照片：按 id 从当前照片集合派生，点赞等更新会立即反映到模态框 */
export function selectSelectedPhoto(
  photos: Photo[],
  selectedPhotoId: number | null,
): Photo | null {
  if (selectedPhotoId === null) return null;
  return photos.find(photo => photo.id === selectedPhotoId) ?? null;
}
