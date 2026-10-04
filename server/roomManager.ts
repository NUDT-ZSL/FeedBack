import type { User, Question, MatchResult, RadarData, RoomStatus, ServerMessage } from '../shared/types';
import { selectRandomQuestions } from '../shared/questions.ts';
import { calculateMatches, generateRadarData, QUESTION_TIME_MS } from '../shared/matching.ts';

const START_COUNTDOWN_MS = 3000;
const REVEAL_DURATION_MS = 2000;
const DEFAULT_QUESTION_COUNT = 10;

export interface Scheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemScheduler: Scheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
};

export interface RoomOptions {
  scheduler?: Scheduler;
  selectQuestions?: (count: number) => Question[];
  questionCount?: number;
}

export class Room {
  id: string;
  status: RoomStatus;
  users: User[];
  questions: Question[];
  currentQuestion: number;

  private scheduler: Scheduler;
  private selectQuestions: (count: number) => Question[];
  private questionCount: number;
  private timerHandles = new Set<unknown>();
  private destroyed = false;
  private answersRevealed = false;

  constructor(id: string, options: RoomOptions = {}) {
    this.id = id;
    this.status = 'waiting';
    this.users = [];
    this.questions = [];
    this.currentQuestion = -1;
    this.scheduler = options.scheduler ?? systemScheduler;
    this.selectQuestions = options.selectQuestions ?? ((count: number) => selectRandomQuestions(count));
    this.questionCount = options.questionCount ?? DEFAULT_QUESTION_COUNT;
  }

  broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    this.users.forEach(user => {
      if (user.ws && user.ws.readyState === 1) {
        user.ws.send(data);
      }
    });
  }

  sendToUser(userId: string, message: ServerMessage): void {
    const user = this.getUser(userId);
    if (user && user.ws && user.ws.readyState === 1) {
      user.ws.send(JSON.stringify(message));
    }
  }

  addUser(user: Omit<User, 'id' | 'answers'>): User {
    const newUser: User = {
      ...user,
      id: crypto.randomUUID(),
      answers: [],
    };
    this.users.push(newUser);
    return newUser;
  }

  removeUser(userId: string): void {
    this.users = this.users.filter(u => u.id !== userId);
  }

  getUser(userId: string): User | undefined {
    return this.users.find(u => u.id === userId);
  }

  startGame(): void {
    if (this.destroyed || this.status !== 'waiting') return;
    if (this.users.length < 2) {
      throw new Error('至少需要2名用户才能开始游戏');
    }

    this.status = 'playing';
    this.questions = this.selectQuestions(this.questionCount);
    this.currentQuestion = -1;
    this.answersRevealed = false;
    this.users.forEach(user => {
      user.answers = [];
    });

    this.broadcast({ type: 'GAME_STARTING', payload: { countdown: 3 } });

    this.schedule(() => {
      this.nextQuestion();
    }, START_COUNTDOWN_MS);
  }

  nextQuestion(): void {
    if (this.destroyed || this.status !== 'playing') return;

    this.currentQuestion++;
    this.answersRevealed = false;

    if (this.currentQuestion >= this.questions.length) {
      this.endGame();
      return;
    }

    const question = this.questions[this.currentQuestion];
    const startTime = Date.now();

    this.broadcast({
      type: 'QUESTION',
      payload: {
        question,
        index: this.currentQuestion,
        total: this.questions.length,
        startTime,
      },
    });

    this.schedule(() => {
      this.revealAnswers();
    }, QUESTION_TIME_MS);
  }

  submitAnswer(userId: string, questionIndex: number, answer: number, timeSpent: number): void {
    if (this.destroyed || this.status !== 'playing') return;
    if (this.answersRevealed) return;
    const user = this.getUser(userId);
    if (!user) return;
    if (questionIndex !== this.currentQuestion) return;
    if (user.answers.some(a => a.questionIndex === questionIndex)) return;

    const question = this.questions[questionIndex];
    const correct = question.type === 'fact' ? answer === question.correctAnswer : true;

    user.answers.push({ questionIndex, answer, correct, timeSpent });

    this.sendToUser(userId, {
      type: 'ANSWER_RESULT',
      payload: { userId, questionIndex, correct },
    });

    const allAnswered = this.users.every(u =>
      u.answers.some(a => a.questionIndex === questionIndex)
    );

    if (allAnswered) {
      this.revealAnswers();
    }
  }

  private revealAnswers(): void {
    if (this.destroyed || this.status !== 'playing') return;
    if (this.answersRevealed) return;
    this.answersRevealed = true;

    this.clearAllTimers();
    this.sendAllAnswers();
    this.schedule(() => {
      this.nextQuestion();
    }, REVEAL_DURATION_MS);
  }

  private sendAllAnswers(): void {
    const questionIndex = this.currentQuestion;
    const answers = this.users.map(user => {
      const answer = user.answers.find(a => a.questionIndex === questionIndex);
      return {
        userId: user.id,
        answer: answer?.answer ?? -1,
        correct: answer?.correct ?? false,
      };
    });

    this.broadcast({
      type: 'ALL_ANSWERS',
      payload: { questionIndex, answers },
    });
  }

  private endGame(): void {
    if (this.destroyed) return;
    this.status = 'finished';
    this.clearAllTimers();

    const matches = this.calculateMatches();
    const radarData = this.generateRadarData();

    this.broadcast({
      type: 'MATCH_RESULT',
      payload: { matches, radarData },
    });
  }

  calculateMatches(): MatchResult[] {
    return calculateMatches(this.users, this.questions);
  }

  generateRadarData(): RadarData {
    return generateRadarData(this.users, this.questions);
  }

  cleanup(): void {
    this.destroyed = true;
    this.clearAllTimers();
  }

  private schedule(callback: () => void, delayMs: number): void {
    if (this.destroyed) return;
    const handle = this.scheduler.setTimeout(() => {
      this.timerHandles.delete(handle);
      if (this.destroyed) return;
      callback();
    }, delayMs);
    this.timerHandles.add(handle);
  }

  private clearAllTimers(): void {
    this.timerHandles.forEach(handle => {
      this.scheduler.clearTimeout(handle);
    });
    this.timerHandles.clear();
  }
}

export class RoomManager {
  private rooms: Map<string, Room>;
  private roomOptions: RoomOptions;

  constructor(roomOptions: RoomOptions = {}) {
    this.rooms = new Map();
    this.roomOptions = roomOptions;
  }

  createRoom(roomId?: string): Room {
    const id = roomId ?? this.generateRoomId();
    const room = new Room(id, this.roomOptions);
    this.rooms.set(id, room);
    return room;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  deleteRoom(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (room) {
      room.cleanup();
      return this.rooms.delete(roomId);
    }
    return false;
  }

  getOrCreateRoom(roomId: string): Room {
    let room = this.getRoom(roomId);
    if (!room) {
      room = this.createRoom(roomId);
    }
    return room;
  }

  private generateRoomId(): string {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 6; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }
}

export const roomManager = new RoomManager();
