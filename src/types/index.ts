export interface Movie {
  id: string;
  title: string;
  year: number;
  director: string;
  plot: string;
  poster: string;
  genre: string;
  personalRating: number | null;
  watchDate: string | null;
  watched: boolean;
  addedAt: string;
}

export interface SearchResult {
  id: string;
  title: string;
  year: string;
  poster: string;
  type: string;
}

export interface FilterState {
  year: number | null;
  minRating: number | null;
  watched: boolean | null;
  sortBy: 'rating' | 'addedAt';
  sortOrder: 'asc' | 'desc';
}

export type RawImportRecord = Record<string, unknown>;

export interface FieldIssue {
  field: string;
  raw: unknown;
  note: string;
}

export interface NormalizedImport {
  index: number;
  id: string | null;
  title: string;
  year: number;
  genre: string;
  director: string;
  plot: string;
  poster: string;
  personalRating: number | null;
  watchDate: string | null;
  watched: boolean;
  addedAt: string | null;
  issues: FieldIssue[];
}

export type ImportItemStatus =
  | 'added'
  | 'updated'
  | 'unchanged'
  | 'duplicate'
  | 'conflict'
  | 'skipped';

export interface ImportItemResult {
  index: number;
  status: ImportItemStatus;
  title: string;
  reason?: string;
  filledFields?: string[];
  matchedId?: string;
  source?: RawImportRecord;
}

export interface ImportReport {
  fileHash: string;
  total: number;
  items: ImportItemResult[];
  added: number;
  updated: number;
  unchanged: number;
  duplicate: number;
  conflict: number;
  skipped: number;
}

export interface ImportHistoryEntry {
  hash: string;
  importedAt: string;
  total: number;
  added: number;
}
