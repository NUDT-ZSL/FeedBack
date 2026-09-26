export interface Option {
  id: string;
  name: string;
  imageUrl: string;
  description: string;
  votes: number;
}

export interface Activity {
  id: string;
  name: string;
  description: string;
  location: string;
  time: string;
  options: Option[];
  createdAt: number;
  ended: boolean;
  endedAt?: number;
  votedUsers: Record<string, string[]>;
}

export interface VoteMessage {
  type: 'vote' | 'activity_ended' | 'activity_created';
  activityId: string;
  voterId?: string;
  data?: Activity;
  serverTime?: number;
}
