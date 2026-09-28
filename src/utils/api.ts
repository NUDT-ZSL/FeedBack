import type {
  SubmitCodeRequest,
  SubmitCodeResponse,
  RateSnippetRequest,
  RateSnippetResponse,
  GetCodeSnippetsResponse,
  GetUserStatsResponse,
  GetStatsResponse,
} from '@/types';

const API_BASE = '/api';

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function submitCode(data: SubmitCodeRequest): Promise<SubmitCodeResponse> {
  return request<SubmitCodeResponse>('/submit', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function rateSnippet(data: RateSnippetRequest): Promise<RateSnippetResponse> {
  return request<RateSnippetResponse>('/rate', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getCodeSnippets(
  page: number = 1,
  limit: number = 10,
  excludeUserId?: string
): Promise<GetCodeSnippetsResponse> {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });

  if (excludeUserId) {
    params.append('excludeUserId', excludeUserId);
  }

  return request<GetCodeSnippetsResponse>(`/code-snippets?${params.toString()}`, {
    method: 'GET',
  });
}

export async function getUserStats(userId: string): Promise<GetUserStatsResponse> {
  const params = new URLSearchParams({ userId });
  return request<GetUserStatsResponse>(`/user-stats?${params.toString()}`, {
    method: 'GET',
  });
}

export async function getStats(): Promise<GetStatsResponse> {
  return request<GetStatsResponse>('/stats', {
    method: 'GET',
  });
}
