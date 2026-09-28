import { request } from './client';

export function followUser(userId: string, token: string): Promise<unknown> {
  return request<unknown>('/api/user/follow', {
    method: 'POST',
    body: { userId },
    token,
    errorFallback: '操作失败',
  });
}

export function unfollowUser(userId: string, token: string): Promise<unknown> {
  return request<unknown>('/api/user/unfollow', {
    method: 'POST',
    body: { userId },
    token,
    errorFallback: '操作失败',
  });
}
