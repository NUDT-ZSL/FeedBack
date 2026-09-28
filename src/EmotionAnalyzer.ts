export interface EmotionResult {
  keyword: string
  confidence: number
  color: string
}

export interface ParagraphAnalysis {
  paragraph: string
  emotions: EmotionResult[]
  dominant: EmotionResult
}

interface EmotionKeyword {
  keyword: string
  emotion: string
  weight: number
}

export const EMOTION_CONFIGS: Record<string, {
  name: string
  color: string
  gradient: string[]
}> = {
  joy: {
    name: '喜悦',
    color: '#ff9f43',
    gradient: ['#ff9f43', '#ff6b6b', '#ffd93d']
  },
  sadness: {
    name: '悲伤',
    color: '#54a0ff',
    gradient: ['#2e86de', '#54a0ff', '#9c88ff']
  },
  anger: {
    name: '愤怒',
    color: '#ee5253',
    gradient: ['#ee5253', '#ff6b6b', '#ff4757']
  },
  peace: {
    name: '宁静',
    color: '#1dd1a1',
    gradient: ['#1dd1a1', '#10ac84', '#26de81']
  }
}

const KEYWORD_LIBRARY: EmotionKeyword[] = [
  { keyword: '开心', emotion: 'joy', weight: 0.9 },
  { keyword: '快乐', emotion: 'joy', weight: 0.95 },
  { keyword: '高兴', emotion: 'joy', weight: 0.85 },
  { keyword: '愉快', emotion: 'joy', weight: 0.8 },
  { keyword: '幸福', emotion: 'joy', weight: 0.92 },
  { keyword: '欣喜', emotion: 'joy', weight: 0.88 },
  { keyword: '兴奋', emotion: 'joy', weight: 0.82 },
  { keyword: '欢乐', emotion: 'joy', weight: 0.86 },
  { keyword: '喜悦', emotion: 'joy', weight: 0.9 },
  { keyword: '微笑', emotion: 'joy', weight: 0.75 },
  { keyword: '愉悦', emotion: 'joy', weight: 0.8 },
  { keyword: '满足', emotion: 'joy', weight: 0.78 },
  { keyword: '难过', emotion: 'sadness', weight: 0.88 },
  { keyword: '伤心', emotion: 'sadness', weight: 0.92 },
  { keyword: '痛苦', emotion: 'sadness', weight: 0.9 },
  { keyword: '忧伤', emotion: 'sadness', weight: 0.85 },
  { keyword: '失落', emotion: 'sadness', weight: 0.8 },
  { keyword: '沮丧', emotion: 'sadness', weight: 0.86 },
  { keyword: '绝望', emotion: 'sadness', weight: 0.95 },
  { keyword: '哭泣', emotion: 'sadness', weight: 0.82 },
  { keyword: '悲伤', emotion: 'sadness', weight: 0.9 },
  { keyword: '孤独', emotion: 'sadness', weight: 0.78 },
  { keyword: '落寞', emotion: 'sadness', weight: 0.8 },
  { keyword: '惆怅', emotion: 'sadness', weight: 0.75 },
  { keyword: '生气', emotion: 'anger', weight: 0.85 },
  { keyword: '愤怒', emotion: 'anger', weight: 0.92 },
  { keyword: '恼火', emotion: 'anger', weight: 0.82 },
  { keyword: '气愤', emotion: 'anger', weight: 0.88 },
  { keyword: '暴怒', emotion: 'anger', weight: 0.95 },
  { keyword: '愤慨', emotion: 'anger', weight: 0.86 },
  { keyword: '恼怒', emotion: 'anger', weight: 0.84 },
  { keyword: '怒火', emotion: 'anger', weight: 0.9 },
  { keyword: '暴躁', emotion: 'anger', weight: 0.8 },
  { keyword: '烦躁', emotion: 'anger', weight: 0.76 },
  { keyword: '不满', emotion: 'anger', weight: 0.7 },
  { keyword: '讨厌', emotion: 'anger', weight: 0.72 },
  { keyword: '平静', emotion: 'peace', weight: 0.88 },
  { keyword: '安宁', emotion: 'peace', weight: 0.9 },
  { keyword: '宁静', emotion: 'peace', weight: 0.92 },
  { keyword: '平和', emotion: 'peace', weight: 0.86 },
  { keyword: '安静', emotion: 'peace', weight: 0.82 },
  { keyword: '舒缓', emotion: 'peace', weight: 0.8 },
  { keyword: '淡定', emotion: 'peace', weight: 0.78 },
  { keyword: '从容', emotion: 'peace', weight: 0.8 },
  { keyword: '温柔', emotion: 'peace', weight: 0.75 },
  { keyword: '安详', emotion: 'peace', weight: 0.85 },
  { keyword: '惬意', emotion: 'peace', weight: 0.82 },
  { keyword: '悠然', emotion: 'peace', weight: 0.78 }
]

export function analyzeText(text: string): ParagraphAnalysis[] {
  const paragraphs = text.split(/\n+/).filter(p => p.trim().length > 0)
  
  if (paragraphs.length === 0 && text.trim().length > 0) {
    paragraphs.push(text.trim())
  }

  return paragraphs.map(paragraph => analyzeParagraph(paragraph))
}

function analyzeParagraph(paragraph: string): ParagraphAnalysis {
  const emotionScores: Record<string, number> = {
    joy: 0,
    sadness: 0,
    anger: 0,
    peace: 0
  }

  const matchedKeywords: Record<string, string[]> = {
    joy: [],
    sadness: [],
    anger: [],
    peace: []
  }

  KEYWORD_LIBRARY.forEach(({ keyword, emotion, weight }) => {
    if (paragraph.includes(keyword)) {
      emotionScores[emotion] += weight
      matchedKeywords[emotion].push(keyword)
    }
  })

  const totalScore = Object.values(emotionScores).reduce((sum, score) => sum + score, 0)

  const emotions: EmotionResult[] = Object.entries(emotionScores).map(([emotion, score]) => {
    const confidence = totalScore > 0 ? score / totalScore : 0.25
    const keyword = matchedKeywords[emotion][0] || EMOTION_CONFIGS[emotion].name
    return {
      keyword,
      confidence,
      color: EMOTION_CONFIGS[emotion].color
    }
  }).sort((a, b) => b.confidence - a.confidence)

  const dominant = emotions[0] || {
    keyword: '平静',
    confidence: 0.25,
    color: EMOTION_CONFIGS.peace.color
  }

  return {
    paragraph,
    emotions,
    dominant
  }
}
