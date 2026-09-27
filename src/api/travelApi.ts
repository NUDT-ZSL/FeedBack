export interface TravelEvent {
  id: string;
  date: string;
  location: string;
  country: string;
  description: string;
  tags: string[];
  images: string[];
}

export interface FilterParams {
  year?: string;
  country?: string;
  tag?: string;
}

export interface ExportResult {
  markdown: string;
  filename: string;
}

const BASE_URL = '/api';

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        (errorData as { error?: string }).error ||
          `请求失败: ${response.status} ${response.statusText}`
      );
    }

    return (await response.json()) as T;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : '网络请求错误，请检查后端是否启动';
    console.error(`[travelApi] ${path} 错误:`, message);
    throw new Error(message);
  }
}

export async function fetchEventList(): Promise<TravelEvent[]> {
  return request<TravelEvent[]>('/events', { method: 'GET' });
}

export async function addEvent(
  event: Omit<TravelEvent, 'id'>
): Promise<TravelEvent> {
  return request<TravelEvent>('/events', {
    method: 'POST',
    body: JSON.stringify(event),
  });
}

export async function filterEvents(
  params: FilterParams
): Promise<TravelEvent[]> {
  const query = new URLSearchParams();
  if (params.year) query.set('year', params.year);
  if (params.country) query.set('country', params.country);
  if (params.tag) query.set('tag', params.tag);
  const queryString = query.toString();
  const path = queryString ? `/events/filter?${queryString}` : '/events/filter';
  return request<TravelEvent[]>(path, { method: 'GET' });
}

export async function exportMarkdown(ids: string[]): Promise<ExportResult> {
  return request<ExportResult>('/export', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}
