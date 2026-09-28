export type UserRole = 'actor' | 'director';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string;
  role: UserRole;
  createdAt: string;
}

export interface Play {
  id: string;
  directorId: string;
  director?: User;
  title: string;
  author: string;
  coverUrl: string;
  synopsis: string;
  deadline: string;
  createdAt: string;
  roles: Role[];
  roleCount: number;
}

export interface Role {
  id: string;
  playId: string;
  name: string;
  gender: 'male' | 'female' | 'any';
  ageMin: number;
  ageMax: number;
  dialogue: string;
  sortOrder: number;
  applicationCount: number;
  selectedActorId?: string;
  selectedActor?: Pick<User, 'id' | 'name' | 'avatar'>;
}

export interface Application {
  id: string;
  roleId: string;
  actorId: string;
  actor?: User;
  role?: {
    id: string;
    name: string;
    playId: string;
    playTitle?: string;
  };
  introduction: string;
  experience: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface Interview {
  id: string;
  directorId: string;
  applicationId: string;
  application?: Application;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  type:
    | 'application_approved'
    | 'application_rejected'
    | 'interview_scheduled'
    | 'interview_updated'
    | 'new_application'
    | 'new_play';
  title: string;
  content: string;
  link: string;
  read: boolean;
  createdAt: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export interface PlayListResponse {
  items: Play[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NotificationResponse {
  list: NotificationItem[];
  unread: number;
}

export interface WSMessage<T = unknown> {
  type:
    | 'notification'
    | 'application_update'
    | 'application_status'
    | 'interview_update'
    | 'play_update';
  payload: T;
  timestamp: number;
}
