import type {
  MoodType,
  MoodRecord,
  MoodStats,
  ThresholdConfig,
  AlertEvent,
  ApiResponse,
} from '../types';

const BASE_URL = '/api';

async function request<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${BASE_URL}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  const result: ApiResponse<T> = await response.json();

  if (!result.success) {
    throw new Error(result.error || '请求失败');
  }

  return result.data as T;
}

export async function submitMood(mood: MoodType): Promise<MoodRecord> {
  return request<MoodRecord>('/mood', {
    method: 'POST',
    body: JSON.stringify({ mood }),
  });
}

export async function getTodayStats(): Promise<MoodStats> {
  return request<MoodStats>('/mood/today');
}

export async function getRangeStats(
  startDate: string,
  endDate: string
): Promise<MoodStats[]> {
  const params = new URLSearchParams({ startDate, endDate });
  return request<MoodStats[]>(`/mood/range?${params.toString()}`);
}

export async function getThresholds(): Promise<ThresholdConfig[]> {
  return request<ThresholdConfig[]>('/threshold');
}

export async function setThreshold(
  config: ThresholdConfig
): Promise<ThresholdConfig> {
  return request<ThresholdConfig>('/threshold', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function getAlerts(): Promise<AlertEvent[]> {
  return request<AlertEvent[]>('/alerts');
}

export async function checkAlerts(): Promise<AlertEvent[]> {
  return request<AlertEvent[]>('/alerts/check', {
    method: 'POST',
  });
}
