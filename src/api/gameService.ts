import { LevelConfig, GameResult, LeaderboardEntry, Achievement } from '../types';

export const gameService = {
  async fetchLevels(): Promise<LevelConfig[]> {
    try {
      const res = await fetch('/api/levels');
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  },

  async fetchLevel(id: number): Promise<LevelConfig> {
    try {
      const res = await fetch(`/api/levels/${id}`);
      if (!res.ok) throw new Error('not found');
      return await res.json();
    } catch {
      return null as unknown as LevelConfig;
    }
  },

  async submitScore(result: GameResult): Promise<{ success: boolean }> {
    try {
      const res = await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      });
      if (!res.ok) return { success: false };
      return await res.json();
    } catch {
      return { success: false };
    }
  },

  async fetchScores(levelId: number): Promise<LeaderboardEntry[]> {
    try {
      const res = await fetch(`/api/scores/${levelId}`);
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  },

  async fetchLeaderboard(): Promise<LeaderboardEntry[]> {
    try {
      const res = await fetch('/api/leaderboard');
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  },

  async fetchAchievements(playerName: string): Promise<Achievement[]> {
    try {
      const res = await fetch(`/api/achievements/${encodeURIComponent(playerName)}`);
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  },

  async updateAchievements(playerName: string, achievements: Achievement[]): Promise<{ success: boolean }> {
    try {
      const res = await fetch(`/api/achievements/${encodeURIComponent(playerName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ achievements }),
      });
      if (!res.ok) return { success: false };
      return await res.json();
    } catch {
      return { success: false };
    }
  },
};
