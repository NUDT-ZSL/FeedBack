import { EmotionType, emotionAnalyzer } from '../services/EmotionAnalyzer';

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
const SEMANTIC_THRESHOLD = 0.2;

export class ReactorEngine {
  private analyzer = emotionAnalyzer;

  analyzeAndMatch(newMessage: Message, messageList: Message[]): ReactorMatchResult {
    const updatedMessages = [...messageList];
    const matchedIds: string[] = [];

    for (let i = updatedMessages.length - 1; i >= 0; i--) {
      const msg = updatedMessages[i];
      
      const timeDiff = Math.abs(newMessage.timestamp - msg.timestamp);
      if (timeDiff > TIME_WINDOW_MS) {
        break;
      }

      if (msg.emotionType !== newMessage.emotionType) {
        continue;
      }

      const similarity = this.calculateSemanticSimilarity(newMessage.content, msg.content);
      
      if (similarity >= SEMANTIC_THRESHOLD || msg.emotionType === newMessage.emotionType) {
        matchedIds.push(msg.id);
        updatedMessages[i] = {
          ...msg,
          echoCount: msg.echoCount + 1,
          echoIds: [...msg.echoIds, newMessage.id]
        };
      }
    }

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

  private calculateSemanticSimilarity(text1: string, text2: string): number {
    const words1 = this.tokenize(text1);
    const words2 = this.tokenize(text2);

    if (words1.length === 0 || words2.length === 0) {
      return 0;
    }

    const set1 = new Set(words1);
    const set2 = new Set(words2);

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  private tokenize(text: string): string[] {
    const cleanText = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
    
    const tokens: string[] = [];
    
    for (let i = 0; i < cleanText.length; i++) {
      tokens.push(cleanText[i]);
    }

    for (let i = 0; i < cleanText.length - 1; i++) {
      tokens.push(cleanText.substring(i, i + 2));
    }

    return tokens.filter(t => t.trim().length > 0);
  }

  calculateOverallEmotionIndex(messages: Message[]): number {
    if (messages.length === 0) {
      return 50;
    }

    let totalScore = 0;
    let totalWeight = 0;

    const now = Date.now();
    const decayHalfLife = 10 * 60 * 1000;

    for (const msg of messages) {
      const age = now - msg.timestamp;
      const decay = Math.exp(-age / decayHalfLife);

      let emotionValue = 50;
      if (msg.emotionType === 'positive') {
        emotionValue = 50 + (msg.intensity * 10);
      } else if (msg.emotionType === 'negative') {
        emotionValue = 50 - (msg.intensity * 10);
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

    let positive = 0;
    let negative = 0;
    let neutral = 0;

    for (const msg of messages) {
      if (msg.emotionType === 'positive') positive++;
      else if (msg.emotionType === 'negative') negative++;
      else neutral++;
    }

    const total = messages.length;
    return {
      positive: Math.round((positive / total) * 100),
      negative: Math.round((negative / total) * 100),
      neutral: Math.round((neutral / total) * 100)
    };
  }
}

export const reactorEngine = new ReactorEngine();
