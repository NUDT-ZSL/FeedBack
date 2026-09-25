export interface Chapter {
  id: string;
  title: string;
  startTime: number;
  color: string;
}

export interface Episode {
  id: string;
  title: string;
  description: string;
  audioUrl: string;
  duration: number;
  chapters: Chapter[];
  pollId: string;
}

export interface Comment {
  id: string;
  author: string;
  avatarColor: string;
  content: string;
  timestamp: number;
  episodeId: string;
}

export interface PollOption {
  id: string;
  label: string;
  votes: number;
}

export interface Poll {
  id: string;
  episodeId: string;
  question: string;
  options: PollOption[];
}

export interface WsMessage {
  type: 'comment' | 'poll_update' | 'chapter_sync' | 'subscribe';
  payload: unknown;
}
