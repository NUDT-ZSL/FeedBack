export interface User {
  id: number;
  username: string;
}

export interface Marker {
  x: number;
  z: number;
  text: string;
  color: string;
}

export interface Maze {
  id: string;
  user_id: number;
  name: string;
  style: string;
  grid: number[][] | string;
  markers: Marker[] | string;
  thumbnail: string;
  created_at: string;
  author_name?: string;
}

export interface Attempt {
  id: number;
  maze_id: string;
  username: string;
  time_seconds: number;
  created_at: string;
}

export type Theme = 'dungeon' | 'forest' | 'ice' | 'lava';

export type Tool = 'brush' | 'eraser' | 'start' | 'end' | 'marker';

export type MazeSize = 10 | 15 | 20;

export interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}
