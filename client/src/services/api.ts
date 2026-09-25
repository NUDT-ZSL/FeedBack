const BASE_URL = 'http://localhost:3001';

interface UserInfo {
  id: string;
  username: string;
  createdAt?: string;
}

interface AuthResponse {
  message: string;
  token: string;
  user: UserInfo;
}

interface Directory {
  id: string;
  name: string;
  userId: string;
  parentId: string | null;
  createdAt: string;
}

interface DocumentSummary {
  id: string;
  title: string;
  directoryId: string | null;
  version: number;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

interface HistoryEntry {
  version: number;
  content: string;
  timestamp: string;
}

interface HistorySummary {
  version: number;
  timestamp: string;
  length: number;
}

interface DocumentDetail extends DocumentSummary {
  content: string;
  history: HistoryEntry[];
}

interface SearchResult {
  id: string;
  title: string;
  directoryId: string | null;
  score: number;
  titleMatched: boolean;
  contentMatched: boolean;
  snippet: string;
  updatedAt: string;
}

interface SearchResponse {
  query: string;
  total: number;
  results: SearchResult[];
}

function getToken(): string | null {
  return localStorage.getItem('token');
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMessage = (data as { error?: string }).error || `HTTP ${response.status}`;
    throw new Error(errorMessage);
  }

  return data as T;
}

export function login(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('POST', '/login', { username, password });
}

export function register(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('POST', '/register', { username, password });
}

export function getDirectories(parentId?: string): Promise<Directory[]> {
  const query = parentId !== undefined ? `?parentId=${encodeURIComponent(parentId)}` : '';
  return request<Directory[]>('GET', `/directories${query}`);
}

export function createDirectory(name: string, parentId?: string | null): Promise<Directory> {
  return request<Directory>('POST', '/directories', { name, parentId });
}

export function updateDirectory(
  id: string,
  updates: { name?: string; parentId?: string | null },
): Promise<Directory> {
  return request<Directory>('PUT', `/directories/${id}`, updates);
}

export function deleteDirectory(id: string): Promise<{ message: string; deletedDirectories: number }> {
  return request<{ message: string; deletedDirectories: number }>('DELETE', `/directories/${id}`);
}

export function getDocuments(directoryId?: string): Promise<DocumentSummary[]> {
  const query = directoryId !== undefined ? `?directoryId=${encodeURIComponent(directoryId)}` : '';
  return request<DocumentSummary[]>('GET', `/documents${query}`);
}

export function createDocument(params: {
  title: string;
  directoryId?: string | null;
  content?: string;
}): Promise<DocumentDetail> {
  return request<DocumentDetail>('POST', '/documents', params);
}

export function getDocument(id: string): Promise<DocumentDetail> {
  return request<DocumentDetail>('GET', `/documents/${id}`);
}

export function updateDocument(
  id: string,
  updates: { title?: string; directoryId?: string | null; content?: string },
): Promise<DocumentDetail> {
  return request<DocumentDetail>('PUT', `/documents/${id}`, updates);
}

export function deleteDocument(id: string): Promise<{ message: string; deleted: string }> {
  return request<{ message: string; deleted: string }>('DELETE', `/documents/${id}`);
}

export function getHistory(id: string): Promise<HistorySummary[]> {
  return request<HistorySummary[]>('GET', `/documents/${id}/history`);
}

export function rollbackVersion(id: string, version: number): Promise<{ message: string; document: DocumentDetail }> {
  return request<{ message: string; document: DocumentDetail }>('POST', `/documents/${id}/rollback`, { version });
}

export function searchDocuments(q: string): Promise<SearchResponse> {
  return request<SearchResponse>('GET', `/search?q=${encodeURIComponent(q)}`);
}
