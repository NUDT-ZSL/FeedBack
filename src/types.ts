export interface Annotation {
  id: string;
  text: string;
  highlightColor: string;
  note: string;
  timestamp: number;
  pageNum: number;
}

export interface PageData {
  pageNum: number;
  content: string;
  annotations: Annotation[];
}

export interface SearchResult {
  pageNum: number;
  text: string;
  startIndex: number;
  annotationId?: string;
}

export type FileType = 'pdf' | 'text' | null;
