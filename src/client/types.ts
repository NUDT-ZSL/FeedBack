export interface PollOption {
  id: string;
  text: string;
  votes: number;
}

export interface Poll {
  id: string;
  roomId: string;
  title: string;
  type: 'single' | 'multiple';
  options: PollOption[];
  isActive: boolean;
  createdAt: number;
}

export interface Danmaku {
  id: string;
  roomId: string;
  text: string;
  timestamp: number;
  style?: {
    color: string;
    backgroundColor: string;
  };
}

export interface WordCloudItem {
  word: string;
  count: number;
}

export interface RoomState {
  roomId: string;
  currentPoll: Poll | null;
  danmakuEnabled: boolean;
  blockedWords: string[];
  recentDanmaku: Danmaku[];
}

export interface VoteSubmission {
  roomId: string;
  pollId: string;
  optionIds: string[];
  studentId?: string;
}

export interface DanmakuSubmission {
  roomId: string;
  text: string;
}

export interface CreatePollRequest {
  roomId: string;
  title: string;
  type: 'single' | 'multiple';
  options: string[];
}

export type WebSocketMessage =
  | { type: 'poll_created'; data: Poll }
  | { type: 'poll_updated'; data: Poll }
  | { type: 'danmaku_received'; data: Danmaku }
  | { type: 'danmaku_toggled'; data: { enabled: boolean } }
  | { type: 'word_blocked'; data: { word: string } }
  | { type: 'room_state'; data: RoomState };
