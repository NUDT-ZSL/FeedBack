import { describe, it, expect } from 'vitest'
import {
  analyzeEmotion,
  createEmotionAnalyzer,
  keywordHitScoring,
  DEFAULT_EMOTION_DICTIONARY,
  DEFAULT_HEALING_TIPS,
  type EmotionDictionary
} from '../emotionAnalyzer'

describe('emotionAnalyzer（独立于存储）', () => {
  it('检测开心情绪并返回对应疗愈建议', () => {
    const result = analyzeEmotion('今天真的很开心，一切都很顺利')
    expect(result.emotion).toBe('happy')
    expect(result.tips).toHaveLength(2)
    result.tips.forEach(tip => expect(DEFAULT_HEALING_TIPS.happy).toContain(tip))
  })

  it('剥离 HTML 后检测悲伤情绪', () => {
    const result = analyzeEmotion('<p>今天很<b>难过</b>，非常伤心</p>')
    expect(result.emotion).toBe('sad')
  })

  it('无关键词命中时默认为平和', () => {
    expect(analyzeEmotion('今天去超市买了牛奶和鸡蛋').emotion).toBe('peaceful')
  })

  it('词典可替换', () => {
    const dictionary: EmotionDictionary = {
      happy: ['棒'],
      anxious: [],
      angry: [],
      sad: [],
      peaceful: []
    }
    const analyzer = createEmotionAnalyzer({ dictionary })
    expect(analyzer.analyze('这个方案太棒了').emotion).toBe('happy')
  })

  it('评分规则可替换', () => {
    const analyzer = createEmotionAnalyzer({
      score: () => ({ happy: 0, anxious: 5, angry: 0, sad: 0, peaceful: 0 })
    })
    expect(analyzer.analyze('任意文本').emotion).toBe('anxious')
  })

  it('疗愈建议与挑选规则可替换', () => {
    const analyzer = createEmotionAnalyzer({
      tips: { happy: ['自定义建议A', '自定义建议B'], anxious: [], angry: [], sad: [], peaceful: [] },
      pickTips: tips => tips.slice(0, 1)
    })
    const result = analyzer.analyze('今天很开心')
    expect(result.tips).toEqual(['自定义建议A'])
  })

  it('默认评分规则按关键词命中次数计分', () => {
    const scores = keywordHitScoring('开心快乐', DEFAULT_EMOTION_DICTIONARY)
    expect(scores.happy).toBe(2)
    expect(scores.sad).toBe(0)
  })
})
