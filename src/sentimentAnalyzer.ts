import { eventBus, SentenceAnalysis } from './eventBus'

const positiveWords = [
  '喜欢', '爱', '快乐', '开心', '幸福', '美好', '希望', '梦想', '成功', '加油',
  '努力', '坚持', '勇敢', '自信', '感恩', '温暖', '美好', '精彩', '优秀', '很棒',
  '美好', '未来', '光明', '甜蜜', '温馨', '感动', '感激', '幸运', '顺利', '如意',
  'happy', 'love', 'joy', 'hope', 'dream', 'success', 'great', 'wonderful', 'amazing',
  'beautiful', 'fantastic', 'excellent', 'brilliant', 'awesome', 'nice', 'good', 'best',
  '谢谢', '感谢', '祝福', '祝愿', '期待', '憧憬', '向往', '热爱', '喜爱', '欣赏'
]

const negativeWords = [
  '难过', '伤心', '痛苦', '绝望', '失败', '沮丧', '焦虑', '害怕', '恐惧', '孤独',
  '悲伤', '忧愁', '烦恼', '困扰', '压力', '疲惫', '失落', '迷茫', '困惑', '绝望',
  'sad', 'sadness', 'pain', 'sorrow', 'grief', 'depression', 'anxiety', 'fear', 'lonely',
  'failure', 'disappoint', 'frustrate', 'stress', 'tired', 'exhausted', 'lost', 'confused',
  '糟糕', '难受', '心碎', '崩溃', '绝望', '放弃', '遗憾', '后悔', '愧疚', '羞耻'
]

const intensityWords = [
  '非常', '特别', '极其', '十分', '相当', '很', '真的', '太', '超级', '极度',
  'very', 'extremely', 'so', 'really', 'absolutely', 'totally', 'completely', 'highly',
  '最', '无比', '万分', '深深', '强烈'
]

export class SentimentAnalyzer {
  constructor() {
    eventBus.on('input', this.handleInput.bind(this))
  }

  private handleInput(data: { text: string; originX: number; originY: number }): void {
    const sentences = this.splitSentences(data.text)
    const analyzed = sentences.map(s => this.analyzeSentence(s))
    
    eventBus.emit('analyzed', {
      sentences: analyzed,
      originX: data.originX,
      originY: data.originY
    })
  }

  private splitSentences(text: string): string[] {
    return text
      .split(/[。！？!?\n]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
  }

  private analyzeSentence(sentence: string): SentenceAnalysis {
    const lowerSentence = sentence.toLowerCase()
    let positiveScore = 0
    let negativeScore = 0
    let intensityMultiplier = 1
    const keywords: string[] = []

    intensityWords.forEach(word => {
      if (lowerSentence.includes(word.toLowerCase())) {
        intensityMultiplier *= 1.5
        keywords.push(word)
      }
    })

    positiveWords.forEach(word => {
      const lowerWord = word.toLowerCase()
      const regex = new RegExp(lowerWord, 'g')
      const matches = lowerSentence.match(regex)
      if (matches) {
        positiveScore += matches.length
        if (!keywords.includes(word)) {
          keywords.push(word)
        }
      }
    })

    negativeWords.forEach(word => {
      const lowerWord = word.toLowerCase()
      const regex = new RegExp(lowerWord, 'g')
      const matches = lowerSentence.match(regex)
      if (matches) {
        negativeScore += matches.length
        if (!keywords.includes(word)) {
          keywords.push(word)
        }
      }
    })

    const rawScore = (positiveScore - negativeScore) * intensityMultiplier
    const maxScore = Math.max(positiveScore, negativeScore, 1) * intensityMultiplier
    const normalizedScore = Math.max(-1, Math.min(1, rawScore / maxScore))

    const exclamationCount = (sentence.match(/[！!]/g) || []).length
    const questionCount = (sentence.match(/[？?]/g) || []).length

    let finalScore = normalizedScore
    if (exclamationCount > 0) {
      finalScore *= (1 + exclamationCount * 0.1) * Math.sign(finalScore || 1)
    }
    if (questionCount > 0) {
      finalScore *= 0.8
    }

    finalScore = Math.max(-1, Math.min(1, finalScore))

    return {
      sentence,
      score: finalScore,
      keywords: keywords.slice(0, 5)
    }
  }
}
