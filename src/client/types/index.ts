export interface Band {
  id: string;
  name: string;
  description: string;
  genres: string[];
  memberCount: number;
  contact: string;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
}

export interface Schedule {
  id: string;
  bandId: string;
  bandName: string;
  stage: string;
  startTime: string;
  endTime: string;
  genres: string[];
}

export interface ConflictInfo {
  stage: string;
  startTime: string;
  endTime: string;
  bandName: string;
}

export interface WSMessage {
  type: 'schedule_create' | 'schedule_update' | 'schedule_delete' | 'hello';
  data: Schedule | { id: string } | { message: string };
}

export interface NotificationItem {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

export type FilterStage = string | 'all';
