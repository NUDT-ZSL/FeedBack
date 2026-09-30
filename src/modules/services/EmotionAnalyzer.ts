export type EmotionType = 'positive' | 'negative' | 'neutral';

export interface EmotionAnalysisResult {
  emotionType: EmotionType;
  intensity: number;
  keywords: string[];
}

const positiveKeywords = [
  '开心', '高兴', '快乐', '愉快', '幸福', '满足', '欣喜', '兴奋', '激动', '感动',
  '温暖', '舒适', '安心', '平静', '宁静', '放松', '惬意', '美好', '美妙', '棒',
  '好', '赞', '喜欢', '爱', '爱心', '感谢', '感恩', '希望', '期待', '阳光',
  '晴朗', '美丽', '可爱', '甜', '香', '顺利', '成功', '加油', '鼓励', '治愈'
];

const negativeKeywords = [
  '难过', '伤心', '悲伤', '痛苦', '绝望', '沮丧', '失落', '焦虑', '紧张', '害怕',
  '恐惧', '愤怒', '生气', '烦躁', '郁闷', '无聊', '孤独', '寂寞', '疲惫', '累',
  '困', '讨厌', '厌烦', '失望', '遗憾', '后悔', '愧疚', '羞耻', '尴尬', '担忧',
  '不安', '压力', '痛苦', '难受', '疼', '痛', '哭', '流泪', '黑暗', '阴天'
];

const positiveEmojis = new Set([
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
  '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙',
  '😋', '🤗', '🥳', '😎', '🤠', '😌', '❤️', '🧡', '💛', '💚', '💙',
  '💜', '🤍', '🤎', '❣️', '💕', '💞', '💓', '💗', '💖', '💘',
  '💝', '🌸', '✨', '🎉', '🌞', '🌈', '☀️', '🌟', '⭐', '🎵'
]);

const negativeEmojis = new Set([
  '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😩', '🥺',
  '😢', '😭', '😤', '😠', '😡', '🤬', '💔', '💢', '💣', '🌧️',
  '⛈️', '🌩️', '🌨️', '😰', '😨', '😱', '😓', '😿', '🙀', '☠️'
]);

const EMOJI_PATTERN = /(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}])(?:\u{FE0F})?/gu;

export class EmotionAnalyzer {
  analyze(text: string): EmotionAnalysisResult {
    const normalizedText = String(text ?? '');
    let positiveScore = 0;
    let negativeScore = 0;
    const positiveSignals = new Set<string>();
    const negativeSignals = new Set<string>();

    for (const keyword of positiveKeywords) {
      if (normalizedText.includes(keyword)) {
        positiveScore += 1;
        positiveSignals.add(keyword);
      }
    }

    for (const keyword of negativeKeywords) {
      if (normalizedText.includes(keyword)) {
        negativeScore += 1;
        negativeSignals.add(keyword);
      }
    }

    const emojiMatches = normalizedText.match(EMOJI_PATTERN);

    if (emojiMatches) {
      for (const emoji of new Set(emojiMatches)) {
        if (positiveEmojis.has(emoji)) {
          positiveScore += 2;
          positiveSignals.add(emoji);
        } else if (negativeEmojis.has(emoji)) {
          negativeScore += 2;
          negativeSignals.add(emoji);
        }
      }
    }

    let emotionType: EmotionType = 'neutral';
    let intensity = 1;

    if (positiveScore > negativeScore && positiveScore > 0) {
      emotionType = 'positive';
      intensity = this.scoreToIntensity(positiveScore);
    } else if (negativeScore > positiveScore && negativeScore > 0) {
      emotionType = 'negative';
      intensity = this.scoreToIntensity(negativeScore);
    } else {
      emotionType = 'neutral';
      intensity = 1;
    }

    return {
      emotionType,
      intensity,
      keywords: emotionType === 'positive'
        ? [...positiveSignals].slice(0, 5)
        : emotionType === 'negative'
          ? [...negativeSignals].slice(0, 5)
          : []
    };
  }

  private scoreToIntensity(score: number): number {
    return Math.min(5, Math.max(1, Math.ceil(score / 2)));
  }

  getEmotionColor(type: EmotionType): { start: string; end: string } {
    switch (type) {
      case 'positive':
        return { start: '#FFF9C4', end: '#FFE082' };
      case 'negative':
        return { start: '#E3F2FD', end: '#BBDEFB' };
      case 'neutral':
      default:
        return { start: '#F5F5F5', end: '#E0E0E0' };
    }
  }
}

export const emotionAnalyzer = new EmotionAnalyzer();
