import { Poll, Danmaku, RoomState, WordCloudItem, PollOption } from './types';
import { v4 as uuidv4 } from 'uuid';

class RoomManager {
  private rooms: Map<string, {
    roomId: string;
    currentPoll: Poll | null;
    danmakuEnabled: boolean;
    blockedWords: Set<string>;
    danmakuHistory: Danmaku[];
    votedStudents: Set<string>;
    createdAt: number;
  }>;

  constructor() {
    this.rooms = new Map();
  }

  generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code: string;
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(): string {
    const roomId = this.generateRoomCode();
    this.rooms.set(roomId, {
      roomId,
      currentPoll: null,
      danmakuEnabled: true,
      blockedWords: new Set(),
      danmakuHistory: [],
      votedStudents: new Set(),
      createdAt: Date.now(),
    });
    return roomId;
  }

  roomExists(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  joinRoom(roomId: string): boolean {
    return this.roomExists(roomId);
  }

  createPoll(
    roomId: string,
    title: string,
    type: 'single' | 'multiple',
    optionTexts: string[]
  ): Poll | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const options: PollOption[] = optionTexts.map(text => ({
      id: uuidv4(),
      text,
      votes: 0,
    }));

    const poll: Poll = {
      id: uuidv4(),
      roomId,
      title,
      type,
      options,
      isActive: true,
      createdAt: Date.now(),
    };

    room.currentPoll = poll;
    room.votedStudents = new Set();

    return poll;
  }

  submitVote(
    roomId: string,
    pollId: string,
    optionIds: string[],
    studentId: string = 'anonymous'
  ): Poll | null {
    const room = this.rooms.get(roomId);
    if (!room || !room.currentPoll || room.currentPoll.id !== pollId) {
      return null;
    }

    const voterKey = `${studentId}-${pollId}`;
    if (room.votedStudents.has(voterKey)) {
      return room.currentPoll;
    }

    room.votedStudents.add(voterKey);

    room.currentPoll.options.forEach(option => {
      if (optionIds.includes(option.id)) {
        option.votes++;
      }
    });

    return room.currentPoll;
  }

  submitDanmaku(roomId: string, text: string): Danmaku | null {
    const room = this.rooms.get(roomId);
    if (!room || !room.danmakuEnabled) return null;

    const containsBlocked = Array.from(room.blockedWords).some(word =>
      text.includes(word)
    );
    if (containsBlocked) return null;

    const danmaku: Danmaku = {
      id: uuidv4(),
      roomId,
      text,
      timestamp: Date.now(),
    };

    room.danmakuHistory.push(danmaku);
    if (room.danmakuHistory.length > 500) {
      room.danmakuHistory = room.danmakuHistory.slice(-500);
    }

    return danmaku;
  }

  toggleDanmaku(roomId: string, enabled: boolean): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.danmakuEnabled = enabled;
    return true;
  }

  addBlockedWord(roomId: string, word: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.blockedWords.add(word);
    return true;
  }

  removeBlockedWord(roomId: string, word: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    return room.blockedWords.delete(word);
  }

  getBlockedWords(roomId: string): string[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.blockedWords);
  }

  getWordCloudData(roomId: string, windowMs: number = 60000, limit: number = 30): WordCloudItem[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    const now = Date.now();
    const recentDanmaku = room.danmakuHistory.filter(
      d => now - d.timestamp <= windowMs
    );

    const wordCount = new Map<string, number>();
    const stopWords = new Set(['的', '了', '是', '我', '你', '他', '她', '它', '们', '这', '那', '有', '和', '与', '及', '等', '也', '就', '都', '而', '或', '但', '如果', '因为', '所以', '可以', '可能', '应该', '需要', '什么', '怎么', '为什么', '一个', '一些', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'up', 'about', 'into', 'over', 'after', 'and', 'but', 'or', 'as', 'if', 'when', 'than', 'because', 'while', 'although', 'though', 'that', 'which', 'who', 'whom', 'this', 'these', 'those', 'it', 'its']);

    recentDanmaku.forEach(danmaku => {
      const words = this.tokenize(danmaku.text);
      words.forEach(word => {
        const lowerWord = word.toLowerCase();
        if (lowerWord.length >= 2 && !stopWords.has(lowerWord) && !room.blockedWords.has(lowerWord)) {
          wordCount.set(lowerWord, (wordCount.get(lowerWord) || 0) + 1);
        }
      });
    });

    const result: WordCloudItem[] = Array.from(wordCount.entries())
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    return result;
  }

  private tokenize(text: string): string[] {
    const chineseChars = text.match(/[\u4e00-\u9fa5]+/g) || [];
    const englishWords = text.match(/[a-zA-Z]+/g) || [];
    
    const tokens: string[] = [];
    
    chineseChars.forEach(chars => {
      for (let i = 0; i < chars.length; i++) {
        if (i + 1 < chars.length) {
          tokens.push(chars.substring(i, i + 2));
        }
        tokens.push(chars[i]);
      }
    });
    
    tokens.push(...englishWords);
    
    return tokens;
  }

  getRoomState(roomId: string): RoomState | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    return {
      roomId,
      currentPoll: room.currentPoll,
      danmakuEnabled: room.danmakuEnabled,
      blockedWords: Array.from(room.blockedWords),
      recentDanmaku: room.danmakuHistory.slice(-10),
    };
  }

  cleanupOldRooms(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    Array.from(this.rooms.entries()).forEach(([roomId, room]) => {
      if (now - room.createdAt > maxAgeMs) {
        this.rooms.delete(roomId);
      }
    });
  }
}

export const roomManager = new RoomManager();
