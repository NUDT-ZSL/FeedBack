export type ThemeType = '恐怖' | '悬疑' | '科幻' | '古风' | '搞笑';

export type RoleType = '脑力' | '体力' | '侦察' | '指挥' | '搞笑';

export type EscapeStatus = 'success' | 'failed' | 'all';

export interface Teammate {
  id: string;
  name: string;
  role: RoleType;
  comment: string;
}

export interface EscapeRecord {
  id: string;
  name: string;
  theme: ThemeType;
  storeName: string;
  playerCount: number;
  timeLimit: number;
  actualTime: number | null;
  escaped: boolean;
  teammates: Teammate[];
  createdAt: number;
}

export interface FilterState {
  themes: ThemeType[];
  escapeStatus: EscapeStatus;
  searchText: string;
}

export interface Stats {
  totalRecords: number;
  averageEscapeTime: number;
  successRate: number;
  mostPlayedTheme: ThemeType | null;
  themeCounts: Record<ThemeType, number>;
}
