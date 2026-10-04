import { v4 as uuidv4 } from 'uuid';
import type { User, Question, MatchResult, RadarData, RoomStatus, ServerMessage, SocketLike } from '../shared/types';
import { selectQuestions } from '../shared/questions';
import { calculateMatches, generateRadarData } from '../shared/match';
import { realScheduler, type Scheduler } from '../shared/scheduler';

const QUESTION_TIME = 15000;

export interface RoomOptions {
  seed?: number;
  scheduler?: Scheduler;
}

export class Room {
  id: string;
  status: RoomStatus;
  users: User[];
  questions: Question[];
  currentQuestion: number;
  timers: { questionTimer?: unknown };
  private seed?: number;
  private scheduler: Scheduler;
  private timerHandles: Set<unknown>;
  private destroyed: boolean;
  private acceptingAnswers: boolean;

  constructor(id: string, options: RoomOptions = {}) {
    this.id = id;
    this.status = 'waiting';
    this.users = [];
    this.questions = [];
    this.currentQuestion = -1;
    this.timers = {};
    this.seed = options.seed;
    this.scheduler = options.scheduler ?? realScheduler;
    this.timerHandles = new Set();
    this.destroyed = false;
    this.acceptingAnswers = false;
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

  private clearQuestionTimer(): void {
    if (this.timers.questionTimer !== undefined) {
      this.scheduler.clearTimeout(this.timers.questionTimer);
      this.timerHandles.delete(this.timers.questionTimer);
      this.timers.questionTimer = undefined;
    }
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

  addUser(user: Omit<User, 'id' | 'answers'> & { ws?: SocketLike }): User {
    const newUser: User = {
      ...user,
      id: uuidv4(),
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
    if (this.status !== 'waiting') return;
    if (this.users.length < 2) {
      throw new Error('至少需要2名用户才能开始游戏');
    }

    this.status = 'playing';
    this.questions = selectQuestions(10, this.seed);
    this.currentQuestion = -1;
    this.users.forEach(user => {
      user.answers = [];
    });

    this.broadcast({ type: 'GAME_STARTING', payload: { countdown: 3 } });

    this.schedule(() => {
      this.nextQuestion();
    }, 3000);
  }

  nextQuestion(): void {
    if (this.status !== 'playing') return;

    this.clearQuestionTimer();
    this.acceptingAnswers = false;

    this.currentQuestion++;

    if (this.currentQuestion >= this.questions.length) {
      this.endGame();
      return;
    }

    const question = this.questions[this.currentQuestion];
    const startTime = this.scheduler.now();

    this.broadcast({
      type: 'QUESTION',
      payload: {
        question,
        index: this.currentQuestion,
        total: this.questions.length,
        startTime,
      },
    });

    this.acceptingAnswers = true;

    const handle = this.scheduler.setTimeout(() => {
      this.timerHandles.delete(handle);
      if (this.destroyed) return;
      this.timers.questionTimer = undefined;
      this.acceptingAnswers = false;
      this.sendAllAnswers();
      this.schedule(() => {
        this.nextQuestion();
      }, 2000);
    }, QUESTION_TIME);
    this.timers.questionTimer = handle;
    this.timerHandles.add(handle);
  }

  submitAnswer(userId: string, questionIndex: number, answer: number, timeSpent: number): void {
    const user = this.getUser(userId);
    if (!user || this.status !== 'playing') return;
    if (!this.acceptingAnswers) return;
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
      this.clearQuestionTimer();
      this.acceptingAnswers = false;
      this.sendAllAnswers();
      this.schedule(() => {
        this.nextQuestion();
      }, 2000);
    }
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
    this.status = 'finished';
    this.clearQuestionTimer();
    this.acceptingAnswers = false;

    const matches = calculateMatches(this.users, this.questions);
    const radarData = generateRadarData(this.users, this.questions);

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
    this.acceptingAnswers = false;
    for (const handle of this.timerHandles) {
      this.scheduler.clearTimeout(handle);
    }
    this.timerHandles.clear();
    this.timers.questionTimer = undefined;
  }
}

export class RoomManager {
  private rooms: Map<string, Room>;
  private defaultOptions: RoomOptions;

  constructor(defaultOptions: RoomOptions = {}) {
    this.rooms = new Map();
    this.defaultOptions = defaultOptions;
  }

  createRoom(roomId?: string, options?: RoomOptions): Room {
    const id = roomId ?? this.generateRoomId();
    const room = new Room(id, { ...this.defaultOptions, ...options });
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

  getOrCreateRoom(roomId: string, options?: RoomOptions): Room {
    let room = this.getRoom(roomId);
    if (!room) {
      room = this.createRoom(roomId, options);
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
