export type QuestionType = 'preference' | 'opinion' | 'fact';

export interface User {
  id: string;
  name: string;
  avatar: string;
  roomId: string;
  answers: { questionIndex: number; answer: number; correct: boolean }[];
}

export interface Question {
  id: string;
  text: string;
  type: QuestionType;
  options: string[];
  correctAnswer: number;
  icon: string;
}

export interface MatchResult {
  userId: string;
  userName: string;
  userAvatar: string;
  matchPercentage: number;
  commonAnswers: { questionIndex: number; answer: number; questionText: string; optionText: string }[];
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
}

export interface RadarData {
  categories: string[];
  selfScores: number[];
  users: { userId: string; userName: string; color: string; scores: number[] }[];
}

export type ClientMessage =
  | { type: 'JOIN_ROOM'; payload: { roomId: string; userName: string; avatar: string } }
  | { type: 'LEAVE_ROOM'; payload: { roomId: string } }
  | { type: 'START_GAME'; payload: { roomId: string } }
  | { type: 'SUBMIT_ANSWER'; payload: { roomId: string; questionIndex: number; answer: number; timeSpent: number } }
  | { type: 'SEND_MESSAGE'; payload: { roomId: string; targetUserId: string; content: string } }
  | { type: 'SEND_INVITE'; payload: { roomId: string; targetUserId: string } }
  | { type: 'RESPOND_INVITE'; payload: { roomId: string; inviterId: string; accepted: boolean } };

export type ServerMessage =
  | { type: 'ROOM_JOINED'; payload: { roomId: string; users: User[] } }
  | { type: 'USER_JOINED'; payload: { user: User } }
  | { type: 'USER_LEFT'; payload: { userId: string } }
  | { type: 'GAME_STARTING'; payload: { countdown: number } }
  | { type: 'QUESTION'; payload: { question: Question; index: number; total: number; startTime: number } }
  | { type: 'ANSWER_RESULT'; payload: { userId: string; questionIndex: number; correct: boolean } }
  | { type: 'ALL_ANSWERS'; payload: { questionIndex: number; answers: { userId: string; answer: number; correct: boolean }[] } }
  | { type: 'MATCH_RESULT'; payload: { matches: MatchResult[]; radarData: RadarData } }
  | { type: 'CHAT_INVITE'; payload: { inviter: User; roomId: string } }
  | { type: 'INVITE_RESPONSE'; payload: { accepted: boolean; chatPartner: User } }
  | { type: 'NEW_MESSAGE'; payload: { message: ChatMessage } }
  | { type: 'ERROR'; payload: { message: string } };
