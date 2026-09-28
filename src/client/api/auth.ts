import type { AuthResponse } from '../types';
import { request, ApiError } from './client';

async function authenticate(
  path: string,
  body: unknown,
  errorFallback: string,
): Promise<AuthResponse> {
  const result = await request<AuthResponse>(path, {
    method: 'POST',
    body,
    token: null,
    errorFallback,
  });
  if (!result) {
    throw new ApiError(errorFallback, 0);
  }
  return result;
}

export function login(username: string, password: string): Promise<AuthResponse> {
  return authenticate('/api/user/login', { username, password }, '登录失败');
}

export function register(
  username: string,
  password: string,
  email?: string,
): Promise<AuthResponse> {
  return authenticate('/api/user/register', { username, email, password }, '注册失败');
}
