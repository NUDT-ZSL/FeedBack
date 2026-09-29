export interface Work {
  id: string
  title: string
  artistId: string
  artistName: string
  styles: string[]
  description: string
  audioUrl: string
  coverGradient: string
  playCount: number
  giftCount: number
  giftValue: number
  createdAt: Date
  isPublic: boolean
}

export interface Comment {
  id: string
  workId: string
  userId: string
  username: string
  content: string
  createdAt: Date
  mentions: string[]
}

export interface User {
  id: string
  name: string
  role: 'artist' | 'fan'
}

export interface GiftType {
  type: 'star' | 'note' | 'heart'
  name: string
  price: number
  icon: string
}

export interface DailyStats {
  date: string
  playCount: number
  giftRevenue: number
  newFans: number
}

export interface FanRanking {
  userId: string
  username: string
  totalGiftValue: number
  rank: number
}

export const STYLE_TAGS = ['流行', '摇滚', '电子', '民谣', '嘻哈', '爵士']

export const GRADIENT_PRESETS = [
  'linear-gradient(135deg, #FF9A9E 0%, #FECFEF 100%)',
  'linear-gradient(135deg, #A8EDEA 0%, #FECFEF 100%)',
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  'linear-gradient(135deg, #ff9a9e 0%, #fecfef 50%, #fecfef 100%)',
  'linear-gradient(135deg, #fdfcfb 0%, #e2d1c3 100%)',
]

export const AVATAR_COLORS = [
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#96CEB4',
  '#FFEAA7',
  '#DDA0DD',
  '#98D8C8',
  '#F7DC6F',
]

export const GIFT_TYPES: GiftType[] = [
  { type: 'star', name: '星星', price: 2, icon: '⭐' },
  { type: 'note', name: '音符', price: 5, icon: '🎵' },
  { type: 'heart', name: '爱心', price: 10, icon: '❤️' },
]

function generateId(): string {
  return Math.random().toString(36).substring(2, 11)
}

function getRandomGradient(): string {
  return GRADIENT_PRESETS[Math.floor(Math.random() * GRADIENT_PRESETS.length)]
}

const initialWorks: Work[] = [
  {
    id: 'work-1',
    title: '午夜旋律',
    artistId: 'artist-1',
    artistName: '夜行者乐队',
    styles: ['电子', '流行'],
    description: '一首关于城市夜晚的电子流行作品，融合了合成器与人声的完美结合，带你进入迷幻的午夜旅程。',
    audioUrl: '',
    coverGradient: GRADIENT_PRESETS[2],
    playCount: 12580,
    giftCount: 342,
    giftValue: 2180,
    createdAt: new Date('2024-01-15'),
    isPublic: true,
  },
  {
    id: 'work-2',
    title: '山海之间',
    artistId: 'artist-1',
    artistName: '夜行者乐队',
    styles: ['民谣', '摇滚'],
    description: '民谣与摇滚的碰撞，讲述山川大海的壮阔与温柔。',
    audioUrl: '',
    coverGradient: GRADIENT_PRESETS[4],
    playCount: 8934,
    giftCount: 156,
    giftValue: 980,
    createdAt: new Date('2024-01-10'),
    isPublic: true,
  },
  {
    id: 'work-3',
    title: '霓虹梦境',
    artistId: 'artist-2',
    artistName: 'Luna',
    styles: ['电子'],
    description: '合成器浪潮下的梦幻电子音乐，带你穿越霓虹闪烁的城市夜空。',
    audioUrl: '',
    coverGradient: GRADIENT_PRESETS[3],
    playCount: 23450,
    giftCount: 567,
    giftValue: 4230,
    createdAt: new Date('2024-01-18'),
    isPublic: true,
  },
  {
    id: 'work-4',
    title: '旧城故事',
    artistId: 'artist-3',
    artistName: '老陈',
    styles: ['民谣'],
    description: '用吉他与口琴，讲述老城里的那些人和事。',
    audioUrl: '',
    coverGradient: GRADIENT_PRESETS[0],
    playCount: 5670,
    giftCount: 89,
    giftValue: 520,
    createdAt: new Date('2024-01-05'),
    isPublic: true,
  },
  {
    id: 'work-5',
    title: 'Bass Drop',
    artistId: 'artist-4',
    artistName: 'DJ Thunder',
    styles: ['电子', '嘻哈'],
    description: '重低音轰炸，电子与嘻哈的完美融合。',
    audioUrl: '',
    coverGradient: GRADIENT_PRESETS[7],
    playCount: 15680,
    giftCount: 423,
    giftValue: 2890,
    createdAt: new Date('2024-01-12'),
    isPublic: true,
  },
  {
    id: 'work-6',
    title: '爵士午后',
    artistId: 'artist-5',
    artistName: 'Blue Note Trio',
    styles: ['爵士'],
    description: '慵懒的午后，一杯咖啡，一曲爵士。',
    audioUrl: '',
    coverGradient: GRADIENT_PRESETS[6],
    playCount: 7823,
    giftCount: 134,
    giftValue: 870,
    createdAt: new Date('2024-01-08'),
    isPublic: true,
  },
  {
    id: 'work-7',
    title: '硬核青春',
    artistId: 'artist-6',
    artistName: '破壳乐队',
    styles: ['摇滚'],
    description: '青春的呐喊，摇滚的力量。',
    audioUrl: '',
    coverGradient: GRADIENT_PRESETS[1],
    playCount: 11230,
    giftCount: 287,
    giftValue: 1780,
    createdAt: new Date('2024-01-14'),
    isPublic: true,
  },
  {
    id: 'work-8',
    title: '城市回响',
    artistId: 'artist-2',
    artistName: 'Luna',
    styles: ['流行', '电子'],
    description: '城市的喧嚣中的一丝宁静，电子与流行的融合之作。',
    audioUrl: '',
    coverGradient: GRADIENT_PRESETS[5],
    playCount: 18920,
    giftCount: 398,
    giftValue: 2560,
    createdAt: new Date('2024-01-16'),
    isPublic: true,
  },
]

const initialComments: Comment[] = [
  {
    id: 'comment-1',
    workId: 'work-1',
    userId: 'fan-1',
    username: '音乐小白',
    content: '太好听了！循环播放中...',
    createdAt: new Date('2024-01-16T10:30:00'),
    mentions: [],
  },
  {
    id: 'comment-2',
    workId: 'work-1',
    userId: 'fan-2',
    username: '电子控',
    content: '这个合成器音色绝了，求音源分享一下吗？',
    createdAt: new Date('2024-01-16T12:15:00'),
    mentions: [],
  },
  {
    id: 'comment-3',
    workId: 'work-1',
    userId: 'fan-3',
    username: '深夜电台',
    content: '@音乐小白 同感！晚上听特别有感觉',
    createdAt: new Date('2024-01-16T14:20:00'),
    mentions: ['音乐小白'],
  },
  {
    id: 'comment-4',
    workId: 'work-3',
    userId: 'fan-4',
    username: '霓虹少年',
    content: 'Luna的歌都好好听！',
    createdAt: new Date('2024-01-19T09:00:00'),
    mentions: [],
  },
  {
    id: 'comment-5',
    workId: 'work-3',
    userId: 'fan-5',
    username: '合成器狂人',
    content: '这首的编曲太有感觉了，百听不厌',
    createdAt: new Date('2024-01-19T11:30:00'),
    mentions: [],
  },
]

const initialDailyStats: DailyStats[] = [
  { date: '01-12', playCount: 1200, giftRevenue: 320, newFans: 45 },
  { date: '01-13', playCount: 1800, giftRevenue: 450, newFans: 62 },
  { date: '01-14', playCount: 2100, giftRevenue: 580, newFans: 78 },
  { date: '01-15', playCount: 2400, giftRevenue: 620, newFans: 85 },
  { date: '01-16', playCount: 3200, giftRevenue: 890, newFans: 120 },
  { date: '01-17', playCount: 2800, giftRevenue: 720, newFans: 95 },
  { date: '01-18', playCount: 3500, giftRevenue: 1050, newFans: 145 },
]

const initialFanRankings: FanRanking[] = [
  { userId: 'fan-1', username: '音乐小白', totalGiftValue: 520, rank: 1 },
  { userId: 'fan-2', username: '电子控', totalGiftValue: 480, rank: 2 },
  { userId: 'fan-3', username: '深夜电台', totalGiftValue: 350, rank: 3 },
  { userId: 'fan-4', username: '霓虹少年', totalGiftValue: 280, rank: 4 },
  { userId: 'fan-5', username: '合成器狂人', totalGiftValue: 220, rank: 5 },
  { userId: 'fan-6', username: '摇滚青年', totalGiftValue: 180, rank: 6 },
  { userId: 'fan-7', username: '民谣诗人', totalGiftValue: 150, rank: 7 },
  { userId: 'fan-8', username: '爵士迷', totalGiftValue: 120, rank: 8 },
  { userId: 'fan-9', username: '嘻哈控', totalGiftValue: 90, rank: 9 },
  { userId: 'fan-10', username: '独立乐迷', totalGiftValue: 60, rank: 10 },
]

let works = [...initialWorks]
let comments = [...initialComments]
let dailyStats = [...initialDailyStats]
let fanRankings = [...initialFanRankings]

export function getWorks(): Work[] {
  return works.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

export function getWorkById(id: string): Work | undefined {
  return works.find(w => w.id === id)
}

export function getCommentsByWorkId(workId: string): Comment[] {
  return comments
    .filter(c => c.workId === workId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

export function addComment(workId: string, userId: string, username: string, content: string, mentions: string[] = []): Comment {
  const newComment: Comment = {
    id: generateId(),
    workId,
    userId,
    username,
    content,
    createdAt: new Date(),
    mentions,
  }
  comments.push(newComment)
  return newComment
}

export function addWork(title: string, styles: string[], description: string): Work {
  const newWork: Work = {
    id: generateId(),
    title,
    artistId: 'artist-1',
    artistName: '夜行者乐队',
    styles,
    description,
    audioUrl: '',
    coverGradient: getRandomGradient(),
    playCount: 0,
    giftCount: 0,
    giftValue: 0,
    createdAt: new Date(),
    isPublic: true,
  }
  works.unshift(newWork)
  return newWork
}

export function sendGift(workId: string, _giftType: string, price: number): { work: Work | undefined; success: boolean } {
  const work = works.find(w => w.id === workId)
  if (work) {
    work.giftCount += 1
    work.giftValue += price
    return { work, success: true }
  }
  return { work: undefined, success: false }
}

export function incrementPlayCount(workId: string): Work | undefined {
  const work = works.find(w => w.id === workId)
  if (work) {
    work.playCount += 1
    return work
  }
  return undefined
}

export function getDailyStats(): DailyStats[] {
  return dailyStats
}

export function getFanRankings(): FanRanking[] {
  return fanRankings
}

export function getTotalPlayCount(): number {
  return works.reduce((sum, w) => sum + w.playCount, 0)
}

export function getTotalGiftRevenue(): number {
  return works.reduce((sum, w) => sum + w.giftValue, 0)
}

export function getTotalFans(): number {
  return dailyStats.reduce((sum, d) => sum + d.newFans, 0)
}

export function hashUsernameToColor(username: string): string {
  let hash = 0
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length
  return AVATAR_COLORS[index]
}

export function getInitials(name: string): string {
  return name.charAt(0).toUpperCase()
}
