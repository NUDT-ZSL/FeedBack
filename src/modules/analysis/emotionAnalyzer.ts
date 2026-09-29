import type { EmotionAnalysis, EmotionType } from '@/types'

export type EmotionDictionary = Record<EmotionType, string[]>
export type HealingTipsMap = Record<EmotionType, string[]>
export type EmotionScores = Record<EmotionType, number>

export const EMOTION_TYPES: EmotionType[] = ['happy', 'anxious', 'angry', 'sad', 'peaceful']

export const DEFAULT_EMOTION_DICTIONARY: EmotionDictionary = {
  happy: [
    '开心', '高兴', '快乐', '幸福', '愉悦', '喜悦', '欣喜', '兴奋', '满足', '感恩',
    '愉快', '欢乐', '欢笑', '甜蜜', '美好', '希望', '成功', '胜利', '热爱', '喜欢',
    '满意', '期待', '放松', '舒适', '安心', '顺利', '惊喜', '感动', '温暖', '阳光'
  ],
  anxious: [
    '焦虑', '紧张', '担心', '不安', '忧虑', '害怕', '恐惧', '压力', '烦躁', '忐忑',
    '纠结', '犹豫', '彷徨', '迷茫', '不安', '心慌', '心乱', '急躁', '着急', '忧心',
    '烦恼', '困扰', '困扰', '不安', '焦虑', '紧张', '烦躁', '不安', '焦躁', '急切'
  ],
  angry: [
    '愤怒', '生气', '恼火', '气愤', '暴燥', '不满', '怨恨', '痛恨', '愤怒', '暴怒',
    '怒火', '恼火', '气恼', '气愤', '愤怒', '不满', '反感', '厌恶', '恼恨', '愤慨',
    '暴躁', '发火', '愤怒', '愤怒', '愤怒', '愤怒', '愤怒', '愤怒', '愤怒', '愤怒'
  ],
  sad: [
    '悲伤', '难过', '伤心', '痛苦', '失落', '沮丧', '绝望', '孤独', '寂寞', '无奈',
    '心碎', '哭泣', '眼泪', '忧伤', '忧愁', '愁闷', '苦闷', '抑郁', '消沉', '低沉',
    '凄凉', '悲惨', '不幸', '失望', '绝望', '痛苦', '悲痛', '哀伤', '惆怅', '遗憾'
  ],
  peaceful: [
    '平静', '平和', '宁静', '安静', '安稳', '淡定', '从容', '坦然', '淡然', '安宁',
    '静谧', '安详', '闲适', '自在', '舒心', '清爽', '轻松', '惬意', '舒坦', '踏实',
    '安稳', '安心', '平和', '宁静', '平静', '祥和', '安稳', '安详', '平和', '平静'
  ]
}

export const DEFAULT_HEALING_TIPS: HealingTipsMap = {
  happy: [
    '记录下这份美好，它将成为你未来的力量源泉 ✨',
    '试着把这份开心分享给身边的人，快乐会加倍！',
    '保持这份积极的心态，继续迎接美好的每一天！',
    '不妨做一件让自己更开心的小事来庆祝一下 🎉'
  ],
  anxious: [
    '深呼吸，试着把担忧写下来，你会发现很多担心其实不会发生 🌿',
    '建议做5分钟正念冥想，专注于当下的呼吸',
    '把让你焦虑的事情分解成小步骤，一次只做一件',
    '适当的运动可以有效缓解焦虑，试试散步或瑜伽'
  ],
  angry: [
    '先给自己10分钟冷静时间，情绪平复后再做决定 🕊️',
    '试着从对方的角度理解事情，也许会有不同的看法',
    '表达愤怒的方式有很多种，运动和写作都是健康的选择',
    '喝一杯温水，闭上眼睛，感受身体的放松'
  ],
  sad: [
    '允许自己悲伤，这是正常的情绪表达，不用强迫自己坚强 💙',
    '和信任的朋友或家人聊聊，倾诉可以减轻一半的痛苦',
    '做一件能让你稍微感到温暖的小事，比如喝杯热饮、看一部温馨的电影',
    '记住，黑夜总会过去，明天又是新的一天 ☀️'
  ],
  peaceful: [
    '享受这份难得的宁静，让身心得到充分的休息 🍃',
    '可以记录下让你感到平和的事物，以后需要时可以回顾',
    '这份平静是很好的状态，试着带着它去完成今天的事情',
    '冥想或阅读可以帮你延续这份美好的心境'
  ]
}

/**
 * 评分规则：统计文本中各情绪词典关键词的命中次数。
 * 可整体替换以实现自定义打分（如权重、分词等）。
 */
export type ScoringRule = (text: string, dictionary: EmotionDictionary) => EmotionScores

/**
 * 建议挑选规则：从某种情绪的疗愈建议中选出要展示的条目。
 */
export type TipsPicker = (tips: string[], emotion: EmotionType) => string[]

export interface EmotionAnalyzerOptions {
  /** 情绪词典，默认使用内置词典 */
  dictionary?: EmotionDictionary
  /** 疗愈建议库，默认使用内置建议 */
  tips?: HealingTipsMap
  /** 评分规则，默认按关键词命中次数计分 */
  score?: ScoringRule
  /** 建议挑选规则，默认随机取 2 条 */
  pickTips?: TipsPicker
  /** 将富文本内容转为纯文本，默认优先使用 DOM，非浏览器环境退化为正则 */
  toPlainText?: (content: string) => string
}

export interface EmotionAnalyzer {
  analyze(content: string): EmotionAnalysis
}

export function defaultToPlainText(content: string): string {
  if (typeof document !== 'undefined') {
    const tmp = document.createElement('div')
    tmp.innerHTML = content
    return tmp.textContent || tmp.innerText || ''
  }
  return content.replace(/<[^>]*>/g, '')
}

export const keywordHitScoring: ScoringRule = (text, dictionary) => {
  const scores = {} as EmotionScores
  EMOTION_TYPES.forEach(emotion => {
    scores[emotion] = 0
    dictionary[emotion].forEach(keyword => {
      if (text.includes(keyword.toLowerCase())) {
        scores[emotion]++
      }
    })
  })
  return scores
}

export const randomTwoTips: TipsPicker = (tips) => {
  return [...tips].sort(() => Math.random() - 0.5).slice(0, 2)
}

export function pickDominantEmotion(scores: EmotionScores): EmotionType {
  let maxScore = 0
  let detected: EmotionType = 'peaceful'
  EMOTION_TYPES.forEach(emotion => {
    if (scores[emotion] > maxScore) {
      maxScore = scores[emotion]
      detected = emotion
    }
  })
  return detected
}

export function createEmotionAnalyzer(options: EmotionAnalyzerOptions = {}): EmotionAnalyzer {
  const dictionary = options.dictionary ?? DEFAULT_EMOTION_DICTIONARY
  const tips = options.tips ?? DEFAULT_HEALING_TIPS
  const score = options.score ?? keywordHitScoring
  const pickTips = options.pickTips ?? randomTwoTips
  const toPlainText = options.toPlainText ?? defaultToPlainText

  return {
    analyze(content: string): EmotionAnalysis {
      const text = toPlainText(content).toLowerCase()
      const scores = score(text, dictionary)
      const emotion = pickDominantEmotion(scores)
      return {
        emotion,
        tips: pickTips(tips[emotion], emotion)
      }
    }
  }
}

const defaultAnalyzer = createEmotionAnalyzer()

export function analyzeEmotion(content: string, options?: EmotionAnalyzerOptions): EmotionAnalysis {
  if (!options) {
    return defaultAnalyzer.analyze(content)
  }
  return createEmotionAnalyzer(options).analyze(content)
}
