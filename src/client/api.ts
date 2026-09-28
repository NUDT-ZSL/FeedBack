import { CreatePollRequest, VoteSubmission, DanmakuSubmission, Poll, WordCloudItem } from './types';

const API_BASE = '/api';
const TIMEOUT = 5000;

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('请求超时，请稍后重试');
    }
    throw error;
  }
}

export async function createRoom(): Promise<{ roomId: string }> {
  const response = await fetchWithTimeout(`${API_BASE}/rooms`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('创建房间失败');
  return response.json();
}

export async function joinRoom(roomId: string): Promise<{ exists: boolean }> {
  const response = await fetchWithTimeout(`${API_BASE}/rooms/${roomId}/join`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('房间不存在');
  return response.json();
}

export async function createPoll(request: CreatePollRequest): Promise<Poll> {
  const response = await fetchWithTimeout(`${API_BASE}/polls`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error('创建投票失败');
  return response.json();
}

export async function submitVote(submission: VoteSubmission): Promise<{ success: boolean }> {
  const response = await fetchWithTimeout(`${API_BASE}/polls/vote`, {
    method: 'POST',
    body: JSON.stringify(submission),
  });
  if (!response.ok) throw new Error('提交投票失败');
  return response.json();
}

export async function submitDanmaku(submission: DanmakuSubmission): Promise<{ success: boolean }> {
  const response = await fetchWithTimeout(`${API_BASE}/danmaku`, {
    method: 'POST',
    body: JSON.stringify(submission),
  });
  if (!response.ok) throw new Error('发送弹幕失败');
  return response.json();
}

export async function toggleDanmaku(roomId: string, enabled: boolean): Promise<{ success: boolean }> {
  const response = await fetchWithTimeout(`${API_BASE}/rooms/${roomId}/danmaku`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) throw new Error('切换弹幕状态失败');
  return response.json();
}

export async function blockWord(roomId: string, word: string): Promise<{ success: boolean }> {
  const response = await fetchWithTimeout(`${API_BASE}/rooms/${roomId}/block-word`, {
    method: 'POST',
    body: JSON.stringify({ word }),
  });
  if (!response.ok) throw new Error('屏蔽词设置失败');
  return response.json();
}

export async function unblockWord(roomId: string, word: string): Promise<{ success: boolean }> {
  const response = await fetchWithTimeout(`${API_BASE}/rooms/${roomId}/block-word`, {
    method: 'DELETE',
    body: JSON.stringify({ word }),
  });
  if (!response.ok) throw new Error('取消屏蔽失败');
  return response.json();
}

export async function getWordCloud(roomId: string): Promise<WordCloudItem[]> {
  const response = await fetchWithTimeout(`${API_BASE}/rooms/${roomId}/wordcloud`);
  if (!response.ok) throw new Error('获取词云数据失败');
  return response.json();
}

export function getDanmakuStyle(): { color: string; backgroundColor: string } {
  const styles = [
    { color: '#ffffff', backgroundColor: '#9b59b6' },
    { color: '#f1c40f', backgroundColor: '#3498db' },
    { color: '#ffffff', backgroundColor: '#e74c3c' },
    { color: '#2c3e50', backgroundColor: '#2ecc71' },
    { color: '#ffffff', backgroundColor: '#34495e' },
    { color: '#e91e63', backgroundColor: '#ffffff' },
  ];
  return styles[Math.floor(Math.random() * styles.length)];
}

export function getRandomDanmakuDuration(): number {
  return 2 + Math.random() * 2;
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function getFeedbackItemBackground(text: string): string {
  const length = text.length;
  if (length <= 20) return 'rgba(15, 52, 96, 0.4)';
  if (length <= 50) return 'rgba(15, 52, 96, 0.6)';
  if (length <= 100) return 'rgba(15, 52, 96, 0.8)';
  return 'rgba(15, 52, 96, 1)';
}

export function getWordColor(): string {
  const colors = [
    '#e94560',
    '#f39c12',
    '#e74c3c',
    '#27ae60',
    '#f1c40f',
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}
