import { EmotionType } from '../services/EmotionAnalyzer';

export interface Message {
  id: string;
  content: string;
  emoji: string;
  emotionType: EmotionType;
  intensity: number;
  timestamp: number;
  anonymousName: string;
  echoCount: number;
  echoIds: string[];
}

export interface ReactorMatchResult {
  updatedMessages: Message[];
  newMessage: Message;
  matchedIds: string[];
}

const TIME_WINDOW_MS = 60 * 1000;

export const ECHO_TIME_WINDOW_MS = TIME_WINDOW_MS;

export interface OverallEmotionIndexOptions {
  referenceTime?: number;
}

export class ReactorEngine {
  analyzeAndMatch(newMessage: Message, messageList: Message[]): ReactorMatchResult {
    const matches = messageList
      .filter(msg =>
        msg.id !== newMessage.id &&
        msg.emotionType === newMessage.emotionType &&
        Math.abs(newMessage.timestamp - msg.timestamp) < TIME_WINDOW_MS
      )
      .sort((a, b) =>
        a.timestamp - b.timestamp ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      );

    const matchedIds = matches.map(msg => msg.id);
    const matchedIdSet = new Set(matchedIds);
    const updatedMessages = messageList.map(msg => {
      if (!matchedIdSet.has(msg.id)) {
        return msg;
      }

      return {
        ...msg,
        echoCount: msg.echoCount + 1,
        echoIds: [...msg.echoIds, newMessage.id]
      };
    });

    const updatedNewMessage = {
      ...newMessage,
      echoIds: matchedIds
    };

    updatedMessages.push(updatedNewMessage);

    return {
      updatedMessages,
      newMessage: updatedNewMessage,
      matchedIds
    };
  }

  calculateOverallEmotionIndex(
    messages: Message[],
    options: OverallEmotionIndexOptions = {}
  ): number {
    if (messages.length === 0) {
      return 50;
    }

    const referenceTime = options.referenceTime ?? Math.max(...messages.map(msg => msg.timestamp));
    let totalScore = 0;
    let totalWeight = 0;
    const decayHalfLife = 10 * 60 * 1000;

    for (const msg of messages) {
      const age = referenceTime - msg.timestamp;
      const decay = Math.exp(-age / decayHalfLife);

      let emotionValue = 50;
      if (msg.emotionType === 'positive') {
        emotionValue = 50 + msg.intensity * 10;
      } else if (msg.emotionType === 'negative') {
        emotionValue = 50 - msg.intensity * 10;
      }

      const weight = decay * msg.intensity;
      totalScore += emotionValue * weight;
      totalWeight += weight;
    }

    if (totalWeight === 0) {
      return 50;
    }

    return Math.max(0, Math.min(100, totalScore / totalWeight));
  }

  calculateEmotionStats(messages: Message[]): { positive: number; negative: number; neutral: number } {
    if (messages.length === 0) {
      return { positive: 33, negative: 33, neutral: 34 };
    }

    const counts = {
      positive: messages.filter(msg => msg.emotionType === 'positive').length,
      negative: messages.filter(msg => msg.emotionType === 'negative').length,
      neutral: messages.filter(msg => msg.emotionType === 'neutral').length
    };

    const total = messages.length;
    const raw = {
      positive: (counts.positive / total) * 100,
      negative: (counts.negative / total) * 100,
      neutral: (counts.neutral / total) * 100
    };

    const result = {
      positive: Math.floor(raw.positive),
      negative: Math.floor(raw.negative),
      neutral: Math.floor(raw.neutral)
    };

    const missing = 100 - result.positive - result.negative - result.neutral;
    const remainderOrder: Array<keyof typeof raw> = ['negative', 'neutral', 'positive'];
    remainderOrder
      .sort((a, b) => (raw[b] - result[b]) - (raw[a] - result[a]));

    for (let i = 0; i < missing; i++) {
      result[remainderOrder[i % remainderOrder.length]] += 1;
    }

    return result;
  }
}

export const reactorEngine = new ReactorEngine();
