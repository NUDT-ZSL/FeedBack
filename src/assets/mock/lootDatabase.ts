import type { ItemSlot, ItemQuality } from '@/modules/shared/types'

interface LootTemplate {
  name: string
  slot: ItemSlot
  quality: ItemQuality
  baseDkp: number
  stats: Record<string, number>
  bossName: string
}

export const BOSS_LIST = Object.freeze([
  '熔火之心',
  '黑龙公主',
  '黑翼之巢',
  '安其拉神殿',
  '纳克萨玛斯'
])

export const LOOT_DATABASE: LootTemplate[] = Object.freeze([
  { name: '力量头盔', slot: 'head', quality: 'epic', baseDkp: 50, stats: { 力量: 35, 耐力: 25, 暴击: 2 }, bossName: '熔火之心' },
  { name: '力量胸甲', slot: 'chest', quality: 'epic', baseDkp: 60, stats: { 力量: 40, 耐力: 30, 防御: 15 }, bossName: '熔火之心' },
  { name: '力量护手', slot: 'hands', quality: 'rare', baseDkp: 30, stats: { 力量: 20, 耐力: 15, 命中: 1 }, bossName: '熔火之心' },
  { name: '毁灭之刃', slot: 'weapon', quality: 'epic', baseDkp: 80, stats: { 攻击: 150, 暴击: 3, 命中: 2 }, bossName: '熔火之心' },
  { name: '黑曜石护盾', slot: 'shield', quality: 'epic', baseDkp: 55, stats: { 护甲: 200, 耐力: 25, 防御: 20 }, bossName: '熔火之心' },
  { name: '愤怒头盔', slot: 'head', quality: 'epic', baseDkp: 65, stats: { 力量: 45, 耐力: 35, 暴击: 2 }, bossName: '黑翼之巢' },
  { name: '愤怒胸甲', slot: 'chest', quality: 'epic', baseDkp: 75, stats: { 力量: 50, 耐力: 40, 防御: 20 }, bossName: '黑翼之巢' },
  { name: '兄弟会之剑', slot: 'weapon', quality: 'epic', baseDkp: 100, stats: { 攻击: 200, 力量: 30, 耐力: 25 }, bossName: '黑翼之巢' },
  { name: '生命宝石', slot: 'trinket', quality: 'epic', baseDkp: 70, stats: { 耐力: 30, 生命回复: 5 }, bossName: '黑翼之巢' },
  { name: '巨龙追猎者头盔', slot: 'head', quality: 'epic', baseDkp: 60, stats: { 敏捷: 35, 耐力: 25, 暴击: 2 }, bossName: '黑翼之巢' },
  { name: '血牙头巾', slot: 'head', quality: 'epic', baseDkp: 60, stats: { 敏捷: 40, 耐力: 20, 暴击: 3 }, bossName: '黑翼之巢' },
  { name: '血牙胸甲', slot: 'chest', quality: 'epic', baseDkp: 70, stats: { 敏捷: 45, 耐力: 25, 命中: 2 }, bossName: '黑翼之巢' },
  { name: '无尽风暴头盔', slot: 'head', quality: 'epic', baseDkp: 55, stats: { 智力: 35, 耐力: 25, 治疗: 50 }, bossName: '黑翼之巢' },
  { name: '审判头盔', slot: 'head', quality: 'epic', baseDkp: 60, stats: { 智力: 30, 耐力: 30, 治疗: 60 }, bossName: '黑翼之巢' },
  { name: '信仰头盔', slot: 'head', quality: 'epic', baseDkp: 65, stats: { 智力: 40, 精神: 30, 治疗: 70 }, bossName: '纳克萨玛斯' },
  { name: '霜火头饰', slot: 'head', quality: 'epic', baseDkp: 65, stats: { 智力: 40, 耐力: 25, 法伤: 45 }, bossName: '纳克萨玛斯' },
  { name: '瘟疫之心头饰', slot: 'head', quality: 'epic', baseDkp: 60, stats: { 智力: 35, 耐力: 25, 暗伤: 50 }, bossName: '纳克萨玛斯' },
  { name: '米奈希尔之力', slot: 'weapon', quality: 'epic', baseDkp: 120, stats: { 攻击: 250, 力量: 40, 耐力: 35 }, bossName: '纳克萨玛斯' },
  { name: '堕落的灰烬使者', slot: 'weapon', quality: 'epic', baseDkp: 150, stats: { 攻击: 280, 力量: 35, 暴击: 3 }, bossName: '纳克萨玛斯' },
  { name: '索利达尔·群星之怒', slot: 'weapon', quality: 'epic', baseDkp: 100, stats: { 远程攻击: 200, 敏捷: 35, 暴击: 3 }, bossName: '太阳之井' },
  { name: '奥妮克希亚龙牙坠饰', slot: 'neck', quality: 'epic', baseDkp: 45, stats: { 暴击: 2, 命中: 1, 攻击强度: 40 }, bossName: '黑龙公主' },
  { name: '屠龙者的徽记', slot: 'ring', quality: 'epic', baseDkp: 40, stats: { 力量: 15, 耐力: 15, 防御: 10 }, bossName: '黑龙公主' },
  { name: '紧绷肌腱之弓', slot: 'weapon', quality: 'rare', baseDkp: 35, stats: { 远程攻击: 120, 敏捷: 15, 耐力: 10 }, bossName: '安其拉神殿' },
  { name: '神圣其拉短剑', slot: 'weapon', quality: 'epic', baseDkp: 70, stats: { 攻击: 130, 匕首技能: 2, 暴击: 1 }, bossName: '安其拉神殿' },
  { name: '神秘头饰', slot: 'head', quality: 'rare', baseDkp: 25, stats: { 智力: 25, 耐力: 15, 法伤: 20 }, bossName: '熔火之心' },
  { name: '鬼雾面具', slot: 'head', quality: 'rare', baseDkp: 25, stats: { 智力: 25, 耐力: 15, 暗伤: 25 }, bossName: '熔火之心' },
  { name: '大地之怒头盔', slot: 'head', quality: 'rare', baseDkp: 25, stats: { 智力: 25, 耐力: 15, 治疗: 35 }, bossName: '熔火之心' },
  { name: '巨人追猎者头盔', slot: 'head', quality: 'rare', baseDkp: 25, stats: { 敏捷: 25, 耐力: 15, 远程攻击: 50 }, bossName: '熔火之心' },
  { name: '夜幕杀手头巾', slot: 'head', quality: 'rare', baseDkp: 25, stats: { 敏捷: 25, 耐力: 15, 攻击强度: 40 }, bossName: '熔火之心' },
  { name: '光铸头盔', slot: 'head', quality: 'rare', baseDkp: 25, stats: { 力量: 15, 智力: 15, 治疗: 35 }, bossName: '熔火之心' },
  { name: '虔诚头饰', slot: 'head', quality: 'rare', baseDkp: 25, stats: { 智力: 20, 精神: 20, 治疗: 40 }, bossName: '熔火之心' },
  { name: '博学者头冠', slot: 'head', quality: 'rare', baseDkp: 25, stats: { 智力: 25, 耐力: 10, 法伤: 20 }, bossName: '熔火之心' },
  { name: '冲击束带', slot: 'waist', quality: 'epic', baseDkp: 45, stats: { 力量: 30, 耐力: 20, 暴击: 2 }, bossName: '黑翼之巢' },
  { name: '放逐肩铠', slot: 'shoulder', quality: 'rare', baseDkp: 20, stats: { 力量: 20, 耐力: 15, 防御: 10 }, bossName: '安其拉神殿' },
  { name: '强烈优势披风', slot: 'back', quality: 'rare', baseDkp: 25, stats: { 暴击: 1, 命中: 1, 攻击强度: 25 }, bossName: '黑翼之巢' },
  { name: '源质丝质披风', slot: 'back', quality: 'epic', baseDkp: 45, stats: { 护甲: 50, 智力: 20, 法伤: 25 }, bossName: '黑翼之巢' },
  { name: '龙爪肩铠', slot: 'shoulder', quality: 'epic', baseDkp: 50, stats: { 力量: 30, 耐力: 25, 防御: 15 }, bossName: '黑翼之巢' },
  { name: '黑龙之爪', slot: 'weapon', quality: 'epic', baseDkp: 65, stats: { 攻击: 140, 力量: 25, 暴击: 1 }, bossName: '黑翼之巢' },
  { name: '龙息手持火炮', slot: 'weapon', quality: 'epic', baseDkp: 60, stats: { 远程攻击: 160, 暴击: 2, 命中: 1 }, bossName: '黑翼之巢' },
  { name: '暗影烈焰法杖', slot: 'weapon', quality: 'epic', baseDkp: 85, stats: { 法伤: 95, 智力: 35, 暴击: 2 }, bossName: '黑翼之巢' },
  { name: '暗影之翼', slot: 'weapon', quality: 'epic', baseDkp: 70, stats: { 治疗: 140, 智力: 30, 精神: 20 }, bossName: '黑翼之巢' },
  { name: '神圣之眼', slot: 'trinket', quality: 'epic', baseDkp: 60, stats: { 治疗: 65, 精神: 15 }, bossName: '熔火之心' },
  { name: '古雷曼格之眼', slot: 'trinket', quality: 'epic', baseDkp: 55, stats: { 法伤: 45, 智力: 15 }, bossName: '熔火之心' },
  { name: '速射强弓', slot: 'weapon', quality: 'epic', baseDkp: 55, stats: { 远程攻击: 140, 攻击速度: 15, 命中: 2 }, bossName: '熔火之心' },
  { name: '毁灭王冠', slot: 'head', quality: 'epic', baseDkp: 65, stats: { 力量: 30, 耐力: 30, 暴击: 3 }, bossName: '熔火之心' },
  { name: '狮心头盔', slot: 'head', quality: 'rare', baseDkp: 20, stats: { 力量: 20, 耐力: 15, 防御: 15 }, bossName: '黑石塔' },
  { name: '泰坦护腿', slot: 'legs', quality: 'epic', baseDkp: 45, stats: { 力量: 35, 耐力: 25, 命中: 2 }, bossName: '熔火之心' },
  { name: '烈焰守卫护手', slot: 'hands', quality: 'rare', baseDkp: 20, stats: { 力量: 18, 耐力: 12, 命中: 1 }, bossName: '熔火之心' },
  { name: '稳固腰带', slot: 'waist', quality: 'uncommon', baseDkp: 15, stats: { 耐力: 20, 防御: 10 }, bossName: '熔火之心' },
  { name: '岩浆长靴', slot: 'feet', quality: 'uncommon', baseDkp: 15, stats: { 力量: 15, 耐力: 15 }, bossName: '熔火之心' },
  { name: '火焰抗性之戒', slot: 'ring', quality: 'uncommon', baseDkp: 10, stats: { 火焰抗性: 20, 耐力: 10 }, bossName: '熔火之心' },
  { name: '自然抗性护腕', slot: 'wrist', quality: 'uncommon', baseDkp: 10, stats: { 自然抗性: 15, 智力: 10 }, bossName: '安其拉神殿' },
  { name: '冰霜抗性腰带', slot: 'waist', quality: 'uncommon', baseDkp: 10, stats: { 冰霜抗性: 15, 耐力: 12 }, bossName: '纳克萨玛斯' },
  { name: '暗影抗性披风', slot: 'back', quality: 'uncommon', baseDkp: 10, stats: { 暗影抗性: 15, 护甲: 30 }, bossName: '黑翼之巢' },
  { name: '奥术抗性项链', slot: 'neck', quality: 'uncommon', baseDkp: 10, stats: { 奥术抗性: 15, 智力: 8 }, bossName: '卡拉赞' },
  { name: '厚重的板甲护腿', slot: 'legs', quality: 'uncommon', baseDkp: 12, stats: { 力量: 12, 耐力: 18 }, bossName: '斯坦索姆' },
  { name: '亮布长袍', slot: 'chest', quality: 'uncommon', baseDkp: 12, stats: { 智力: 18, 精神: 12 }, bossName: '通灵学院' },
  { name: '魔化皮甲护肩', slot: 'shoulder', quality: 'uncommon', baseDkp: 12, stats: { 敏捷: 15, 耐力: 10 }, bossName: '黑石深渊' },
  { name: '元素师护腕', slot: 'wrist', quality: 'uncommon', baseDkp: 10, stats: { 智力: 12, 法伤: 10 }, bossName: '厄运之槌' },
  { name: '侍从之戒', slot: 'ring', quality: 'uncommon', baseDkp: 8, stats: { 力量: 10, 耐力: 10 }, bossName: '血色修道院' }
])
