export type PlayerClass = 'warrior' | 'mage' | 'priest' | 'rogue' | 'hunter' | 'warlock' | 'paladin' | 'shaman'

export type ItemQuality = 'epic' | 'rare' | 'uncommon'

export type ItemSlot = 'head' | 'neck' | 'shoulder' | 'chest' | 'back' | 'wrist' | 'hands' | 'waist' | 'legs' | 'feet' | 'ring' | 'trinket' | 'weapon' | 'shield'

export type AllocationMode = 'bidding' | 'rolling'

export interface Player {
  id: string
  name: string
  playerClass: PlayerClass
  dkp: number
  gearScore: number
  demandHistory: string[]
}

export interface LootItem {
  id: string
  name: string
  slot: ItemSlot
  quality: ItemQuality
  baseDkp: number
  stats: Record<string, number>
  bossName: string
}

export interface AllocationRecord {
  id: string
  timestamp: number
  bossName: string
  item: LootItem
  winner: Player
  mode: AllocationMode
  bidAmount?: number
  rollAmount?: number
}

export interface Bid {
  playerId: string
  amount: number
}

export interface AllocationResult {
  success: boolean
  winner?: Player
  dkpSpent?: number
  roll?: number
}

export const PLAYER_CLASS_NAMES: Record<PlayerClass, string> = Object.freeze({
  warrior: '战士',
  mage: '法师',
  priest: '牧师',
  rogue: '盗贼',
  hunter: '猎人',
  warlock: '术士',
  paladin: '圣骑士',
  shaman: '萨满'
})

export const PLAYER_CLASS_COLORS: Record<PlayerClass, string> = Object.freeze({
  warrior: '#C69B6D',
  mage: '#3FC7EB',
  priest: '#FFFFFF',
  rogue: '#FFF468',
  hunter: '#AAD372',
  warlock: '#8788EE',
  paladin: '#F48CBA',
  shaman: '#0070DD'
})

export const ITEM_QUALITY_COLORS: Record<ItemQuality, string> = Object.freeze({
  epic: '#A335EE',
  rare: '#0070DD',
  uncommon: '#1EFF00'
})

export const ITEM_QUALITY_NAMES: Record<ItemQuality, string> = Object.freeze({
  epic: '史诗',
  rare: '精良',
  uncommon: '优秀'
})

export const ITEM_SLOT_NAMES: Record<ItemSlot, string> = Object.freeze({
  head: '头部',
  neck: '项链',
  shoulder: '肩部',
  chest: '胸部',
  back: '背部',
  wrist: '手腕',
  hands: '手部',
  waist: '腰部',
  legs: '腿部',
  feet: '脚部',
  ring: '戒指',
  trinket: '饰品',
  weapon: '武器',
  shield: '盾牌'
})

export const PLAYER_CLASS_ICONS: Record<PlayerClass, string> = Object.freeze({
  warrior: 'fa-shield-halved',
  mage: 'fa-wand-magic-sparkles',
  priest: 'fa-hands-praying',
  rogue: 'fa-dagger',
  hunter: 'fa-bow-arrow',
  warlock: 'fa-skull',
  paladin: 'fa-hammer',
  shaman: 'fa-bolt-lightning'
})
