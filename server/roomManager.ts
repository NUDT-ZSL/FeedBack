import { v4 as uuidv4 } from 'uuid';
import type { User, Question, MatchResult, RadarData, RoomStatus, ServerMessage } from '../shared/types';
import { selectRandomQuestions } from '../shared/questions';

const QUESTION_TIME = 15000;
const USER_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];

export class Room {
  id: string;
  status: RoomStatus;
  users: User[];
  questions: Question[];
  currentQuestion: number;
  timers: { questionTimer?: NodeJS.Timeout };

  constructor(id: string) {
    this.id = id;
    this.status = 'waiting';
    this.users = [];
    this.questions = [];
    this.currentQuestion = -1;
    this.timers = {};
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

  addUser(user: Omit<User, 'id' | 'answers'> & { ws?: WebSocket }): User {
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
    this.questions = selectRandomQuestions(10);
    this.currentQuestion = -1;
    this.users.forEach(user => {
      user.answers = [];
    });

    this.broadcast({ type: 'GAME_STARTING', payload: { countdown: 3 } });

    setTimeout(() => {
      this.nextQuestion();
    }, 3000);
  }

  nextQuestion(): void {
    if (this.status !== 'playing') return;

    if (this.timers.questionTimer) {
      clearTimeout(this.timers.questionTimer);
    }

    this.currentQuestion++;

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

    this.timers.questionTimer = setTimeout(() => {
      this.sendAllAnswers();
      setTimeout(() => {
        this.nextQuestion();
      }, 2000);
    }, QUESTION_TIME);
  }

  submitAnswer(userId: string, questionIndex: number, answer: number, timeSpent: number): void {
    const user = this.getUser(userId);
    if (!user || this.status !== 'playing') return;
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
      if (this.timers.questionTimer) {
        clearTimeout(this.timers.questionTimer);
      }
      this.sendAllAnswers();
      setTimeout(() => {
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
    if (this.timers.questionTimer) {
      clearTimeout(this.timers.questionTimer);
    }

    const matches = this.calculateMatches();
    const radarData = this.generateRadarData();

    this.broadcast({
      type: 'MATCH_RESULT',
      payload: { matches, radarData },
    });
  }

  calculateMatches(): MatchResult[] {
    if (this.users.length < 2) return [];

    const results: MatchResult[] = [];

    for (let i = 0; i < this.users.length; i++) {
      for (let j = i + 1; j < this.users.length; j++) {
        const user1 = this.users[i];
        const user2 = this.users[j];

        let commonCount = 0;
        const commonAnswers: MatchResult['commonAnswers'] = [];

        this.questions.forEach((question, idx) => {
          const ans1 = user1.answers.find(a => a.questionIndex === idx);
          const ans2 = user2.answers.find(a => a.questionIndex === idx);

          if (ans1 && ans2 && ans1.answer === ans2.answer && ans1.answer !== -1) {
            commonCount++;
            commonAnswers.push({
              questionIndex: idx,
              answer: ans1.answer,
              questionText: question.text,
              optionText: question.options[ans1.answer],
            });
          }
        });

        const matchPercentage = Math.round((commonCount / this.questions.length) * 100);

        results.push({
          userId: user2.id,
          userName: user2.name,
          userAvatar: user2.avatar,
          matchPercentage,
          commonAnswers,
        });
      }
    }

    return results.sort((a, b) => b.matchPercentage - a.matchPercentage);
  }

  generateRadarData(): RadarData {
    const categories = ['生活偏好', '观点态度', '知识掌握', '答题速度', '正确率'];

    const users = this.users.map((user, idx) => {
      const scores = this.calculateUserScores(user);
      return {
        userId: user.id,
        userName: user.name,
        color: USER_COLORS[idx % USER_COLORS.length],
        scores,
      };
    });

    return {
      categories,
      selfScores: users[0]?.scores ?? [0, 0, 0, 0, 0],
      users,
    };
  }

  private calculateUserScores(user: User): number[] {
    let preferenceScore = 0;
    let opinionScore = 0;
    let factScore = 0;
    let preferenceCount = 0;
    let opinionCount = 0;
    let factCount = 0;
    let totalTime = 0;
    let correctCount = 0;
    let answeredCount = 0;

    this.questions.forEach((question, idx) => {
      const answer = user.answers.find(a => a.questionIndex === idx);
      if (!answer || answer.answer === -1) return;

      answeredCount++;
      totalTime += answer.timeSpent;

      if (question.type === 'preference') {
        preferenceCount++;
        preferenceScore += 100;
      } else if (question.type === 'opinion') {
        opinionCount++;
        opinionScore += 100;
      } else if (question.type === 'fact') {
        factCount++;
        if (answer.correct) {
          correctCount++;
          factScore += 100;
        }
      }
    });

    const avgPreference = preferenceCount > 0 ? preferenceScore / preferenceCount : 0;
    const avgOpinion = opinionCount > 0 ? opinionScore / opinionCount : 0;
    const avgFact = factCount > 0 ? factScore / factCount : 0;
    const speedScore = answeredCount > 0 ? Math.max(0, 100 - (totalTime / answeredCount / 15000) * 50) : 0;
    const accuracyScore = answeredCount > 0 ? (correctCount / factCount) * 100 : 0;

    return [
      Math.round(avgPreference),
      Math.round(avgOpinion),
      Math.round(avgFact),
      Math.round(speedScore),
      Math.round(accuracyScore),
    ];
  }

  cleanup(): void {
    if (this.timers.questionTimer) {
      clearTimeout(this.timers.questionTimer);
    }
  }
}

export class RoomManager {
  private rooms: Map<string, Room>;

  constructor() {
    this.rooms = new Map();
  }

  createRoom(roomId?: string): Room {
    const id = roomId ?? this.generateRoomId();
    const room = new Room(id);
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
