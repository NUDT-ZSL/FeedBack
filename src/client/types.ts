export interface Comment {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
}

export interface Work {
  id: string;
  artistId: string;
  title: string;
  series: string;
  scale: string;
  material: string;
  images: string[];
  story: string;
  forSale: boolean;
  likes: number;
  comments: Comment[];
  heat: number;
}

export interface Exhibition {
  id: string;
  curatorId: string;
  title: string;
  coverImage: string;
  description: string;
  startDate: string;
  endDate: string;
  maxWorks: number;
  workIds: string[];
  works?: Work[];
  workCount?: number;
}

export interface Artist {
  id: string;
  name: string;
  avatar: string;
  role: 'artist' | 'curator';
}

export interface AppState {
  exhibitions: Exhibition[];
  works: Work[];
  artists: Artist[];
  currentUser: Artist | null;
  loading: boolean;
}

export type AppAction =
  | { type: 'SET_EXHIBITIONS'; payload: Exhibition[] }
  | { type: 'SET_WORKS'; payload: Work[] }
  | { type: 'SET_ARTISTS'; payload: Artist[] }
  | { type: 'SET_USER'; payload: Artist | null }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'UPDATE_WORK'; payload: Work }
  | { type: 'ADD_WORK'; payload: Work }
  | { type: 'UPDATE_EXHIBITION'; payload: Exhibition };
