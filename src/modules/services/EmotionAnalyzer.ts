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

const positiveEmojis = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
  '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙',
  '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫',
  '🤔', '🫡', '🤔', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒',
  '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠',
  '🥳', '🥸', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯',
  '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭',
  '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡',
  '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺',
  '👻', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼',
  '😽', '🙀', '😿', '😾', '❤️', '🧡', '💛', '💚', '💙', '💜',
  '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖',
  '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯',
  '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌',
  '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑',
  '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️',
  '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️',
  '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔',
  '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞',
  '📵', '🔕', '☎️', '📞', '📟', '📠', '💬', '💭', '🗯️', '💤',
  '💈', '💢', '💥', '💫', '💦', '💨', '🕳️', '💣', '💬', '👁️‍🗨️',
  '🗨️', '🗣️', '👤', '👥', '👶', '👧', '🧒', '👦', '👩', '🧑',
  '👨', '👱', '👴', '👵', '🙍', '🙎', '🙅', '🙆', '💁', '🙋',
  '🙌', '🙏', '✍️', '🦵', '🦶', '👂', '👃', '🧠', '🦷', '🦴',
  '👀', '👁️', '👅', '💋', '💄', '💍', '💎', '🔇', '🔈', '🔉',
  '🔊', '🔔', '🔕', '📯', '🎙️', '🎚️', '🎛️', '📻', '🎷', '🎸',
  '🎹', '🎺', '🎻', '🪕', '🥁', '🎵', '🎶', '🎼', '🎤', '🎧',
  '🎬', '🎞️', '🎥', '📺', '📷', '📸', '📹', '📼', '🔍', '🔎',
  '🔬', '🔭', '📡', '💻', '📱', '☎️', '⌨️', '🖥️', '🖨️', '🖱️'
];

const negativeEmojis = [
  '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😩', '🥺',
  '😢', '😭', '😤', '😠', '😡', '🤬', '😈', '👿', '💀', '☠️',
  '💔', '💢', '💣', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '🥶', '😰',
  '😨', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '😟', '😕'
];

export class EmotionAnalyzer {
  analyze(text: string): EmotionAnalysisResult {
    let positiveScore = 0;
    let negativeScore = 0;
    const foundKeywords: string[] = [];

    for (const keyword of positiveKeywords) {
      if (text.includes(keyword)) {
        positiveScore += 1;
        foundKeywords.push(keyword);
      }
    }

    for (const keyword of negativeKeywords) {
      if (text.includes(keyword)) {
        negativeScore += 1;
        foundKeywords.push(keyword);
      }
    }

    const emojiMatches = text.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{1F004}\u{1F0CF}\u{1F170}\u{1F171}\u{1F17E}\u{1F17F}\u{1F18E}\u{3030}\u{2B50}\u{2B55}\u{2B06}\u{2194}\u{2195}\u{2196}\u{2197}\u{2198}\u{2199}\u{23F3}\u{231B}\u{23F0}\u{231A}\u{25AA}\u{25AB}\u{25FE}\u{25FD}\u{25FB}\u{25FC}]/gu);
    
    if (emojiMatches) {
      for (const emoji of emojiMatches) {
        if (positiveEmojis.includes(emoji)) {
          positiveScore += 2;
          foundKeywords.push(emoji);
        } else if (negativeEmojis.includes(emoji)) {
          negativeScore += 2;
          foundKeywords.push(emoji);
        }
      }
    }

    let emotionType: EmotionType = 'neutral';
    let intensity = 1;

    if (positiveScore > negativeScore && positiveScore > 0) {
      emotionType = 'positive';
      intensity = Math.min(5, Math.max(1, Math.ceil(positiveScore / 2)));
    } else if (negativeScore > positiveScore && negativeScore > 0) {
      emotionType = 'negative';
      intensity = Math.min(5, Math.max(1, Math.ceil(negativeScore / 2)));
    } else {
      emotionType = 'neutral';
      intensity = 1;
    }

    return {
      emotionType,
      intensity,
      keywords: foundKeywords.slice(0, 5)
    };
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
