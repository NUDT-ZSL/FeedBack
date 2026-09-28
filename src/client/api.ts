import type { User, Plant, DiaryEntry, LeaderboardEntry, PlantSpecies } from './types';

const API_BASE = '/api';

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  const data = await response.json().catch(() => ({ success: false, message: '请求失败' }));

  if (!response.ok || !data.success) {
    throw new Error(data.message || `HTTP ${response.status}`);
  }

  return data;
}

export function login(
  username: string,
  password: string
): Promise<{ success: boolean; user: User; token: string }> {
  return request<{ success: boolean; user: User; token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function register(
  username: string,
  password: string
): Promise<{ success: boolean; user: User; token: string }> {
  return request<{ success: boolean; user: User; token: string }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function getUser(id: string): Promise<User> {
  return request<{ success: boolean; user: User }>(`/users/${id}`).then((data) => data.user);
}

export function searchUsers(query: string): Promise<User[]> {
  return request<{ success: boolean; users: User[] }>(
    `/users/search?q=${encodeURIComponent(query)}`
  ).then((data) => data.users);
}

export function addFriend(
  userId: string,
  friendId: string
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/users/${userId}/friends`, {
    method: 'POST',
    body: JSON.stringify({ friendId }),
  });
}

export function getFriends(userId: string): Promise<User[]> {
  return request<{ success: boolean; friends: User[] }>(`/users/${userId}/friends`).then(
    (data) => data.friends
  );
}

export function createPlant(
  ownerId: string,
  species: PlantSpecies,
  name: string
): Promise<Plant> {
  return request<{ success: boolean; plant: Plant }>('/plants', {
    method: 'POST',
    body: JSON.stringify({ ownerId, species, name }),
  }).then((data) => data.plant);
}

export function getPlants(userId: string): Promise<Plant[]> {
  return request<{ success: boolean; plants: Plant[] }>(`/plants?userId=${userId}`).then(
    (data) => data.plants
  );
}

export function getPlantDetail(plantId: string): Promise<Plant> {
  return request<{ success: boolean; plant: Plant }>(`/plants/${plantId}`).then(
    (data) => data.plant
  );
}

export function waterPlant(
  plantId: string,
  userId: string
): Promise<{ success: boolean; updatedPlant?: Plant; message?: string }> {
  return request<{ success: boolean; updatedPlant?: Plant; message?: string }>(
    `/plants/${plantId}/water`,
    {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }
  );
}

export function fertilizePlant(
  plantId: string,
  userId: string
): Promise<{ success: boolean; updatedPlant?: Plant; message?: string }> {
  return request<{ success: boolean; updatedPlant?: Plant; message?: string }>(
    `/plants/${plantId}/fertilize`,
    {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }
  );
}

export function adjustLight(
  plantId: string,
  userId: string
): Promise<{ success: boolean; updatedPlant?: Plant; message?: string }> {
  return request<{ success: boolean; updatedPlant?: Plant; message?: string }>(
    `/plants/${plantId}/light`,
    {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }
  );
}

export function getDiary(plantId: string): Promise<DiaryEntry[]> {
  return request<{ success: boolean; diary: DiaryEntry[] }>(`/plants/${plantId}/diary`).then(
    (data) => data.diary
  );
}

export function getLeaderboard(): Promise<LeaderboardEntry[]> {
  return request<{ success: boolean; leaderboard: LeaderboardEntry[] }>('/leaderboard').then(
    (data) => data.leaderboard
  );
}
