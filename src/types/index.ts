export interface Photo {
  id: number;
  title: string;
  url: string;
  tags: string[];
  likes: number;
  date: string;
}

export type SortType = 'likes' | 'date';
