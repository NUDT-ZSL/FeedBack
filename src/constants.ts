import { Herb, Element, Pill, PillRarity, Gourd } from './types';

export const ELEMENT_COLORS: Record<Element, string> = {
  wood: '#2ecc71',
  fire: '#e74c3c',
  earth: '#f1c40f',
  metal: '#95a5a6',
  water: '#3498db'
};

export const ELEMENT_NAMES: Record<Element, string> = {
  wood: '木',
  fire: '火',
  earth: '土',
  metal: '金',
  water: '水'
};

export const EFFECT_NAMES: Record<string, string> = {
  longevity: '延寿',
  exorcism: '辟邪',
  spirit: '通灵',
  strength: '力大无穷',
  wisdom: '开悟增智',
  healing: '疗伤圣药',
  invisibility: '隐身',
  flight: '腾云驾雾'
};

export const RARITY_NAMES: Record<PillRarity, string> = {
  common: '凡品',
  uncommon: '良品',
  rare: '上品',
  epic: '极品',
  legendary: '仙品'
};

export const RARITY_COLORS: Record<PillRarity, string> = {
  common: '#95a5a6',
  uncommon: '#27ae60',
  rare: '#2980b9',
  epic: '#8e44ad',
  legendary: '#f39c12'
};

export const HERBS: Herb[] = [
  { id: 'lingzhi', name: '灵芝', element: 'wood', color: '#8b4513', shape: 'mushroom', emoji: '🍄' },
  { id: 'renshen', name: '人参', element: 'wood', color: '#daa520', shape: 'root', emoji: '🌿' },
  { id: 'gouqi', name: '枸杞', element: 'wood', color: '#dc143c', shape: 'leaf', emoji: '🫐' },
  { id: 'fuling', name: '茯苓', element: 'wood', color: '#f5deb3', shape: 'stone', emoji: '🍄' },
  { id: 'heshouwu', name: '何首乌', element: 'wood', color: '#4a3728', shape: 'root', emoji: '🌱' },
  { id: 'danggui', name: '当归', element: 'wood', color: '#cd853f', shape: 'root', emoji: '🌿' },
  
  { id: 'zhusha', name: '朱砂', element: 'fire', color: '#c0392b', shape: 'powder', emoji: '🔴' },
  { id: 'xionghuang', name: '雄黄', element: 'fire', color: '#ff8c00', shape: 'crystal', emoji: '🟠' },
  { id: 'huoyan', name: '火焰草', element: 'fire', color: '#ff4500', shape: 'leaf', emoji: '🔥' },
  { id: 'longan', name: '龙眼', element: 'fire', color: '#8b0000', shape: 'stone', emoji: '🔶' },
  { id: 'shexiang', name: '麝香', element: 'fire', color: '#8b4513', shape: 'powder', emoji: '💫' },
  { id: 'rougui', name: '肉桂', element: 'fire', color: '#a0522d', shape: 'leaf', emoji: '🍂' },
  
  { id: 'huangqi', name: '黄芪', element: 'earth', color: '#d2b48c', shape: 'root', emoji: '🌾' },
  { id: 'gancao', name: '甘草', element: 'earth', color: '#f0e68c', shape: 'root', emoji: '🌿' },
  { id: 'shanyao', name: '山药', element: 'earth', color: '#f5f5dc', shape: 'root', emoji: '🥔' },
  { id: 'dazao', name: '大枣', element: 'earth', color: '#8b0000', shape: 'stone', emoji: '🫒' },
  { id: 'yiren', name: '苡仁', element: 'earth', color: '#fffacd', shape: 'crystal', emoji: '⚪' },
  { id: 'lianzi', name: '莲子', element: 'earth', color: '#f5f5dc', shape: 'stone', emoji: '⚫' },
];

export const ELEMENT_GENERATES: Record<Element, Element> = {
  wood: 'fire',
  fire: 'earth',
  earth: 'metal',
  metal: 'water',
  water: 'wood'
};

export const ELEMENT_OVERCOMES: Record<Element, Element> = {
  wood: 'earth',
  earth: 'water',
  water: 'fire',
  fire: 'metal',
  metal: 'wood'
};

export const PILL_RECIPES: Array<{
  elements: Element[];
  names: string[];
  effects: string[];
  rarity: PillRarity;
}> = [
  { elements: ['wood', 'fire'], names: ['木火丹', '青焰丹'], effects: ['strength', 'longevity'], rarity: 'common' },
  { elements: ['fire', 'earth'], names: ['赤土丹', '炎黄丹'], effects: ['healing', 'longevity'], rarity: 'uncommon' },
  { elements: ['earth', 'metal'], names: ['金土丹', '坤元丹'], effects: ['strength', 'wisdom'], rarity: 'uncommon' },
  { elements: ['metal', 'water'], names: ['水金丹', '碧泉丹'], effects: ['wisdom', 'invisibility'], rarity: 'rare' },
  { elements: ['water', 'wood'], names: ['水木丹', '清元丹'], effects: ['healing', 'spirit'], rarity: 'rare' },
  { elements: ['wood', 'fire', 'earth'], names: ['三才丹', '三元丹'], effects: ['longevity', 'strength'], rarity: 'rare' },
  { elements: ['fire', 'earth', 'metal'], names: ['四象丹', '朱雀丹'], effects: ['exorcism', 'strength'], rarity: 'epic' },
  { elements: ['earth', 'metal', 'water'], names: ['玄武丹', '玄冥丹'], effects: ['wisdom', 'healing'], rarity: 'epic' },
  { elements: ['metal', 'water', 'wood'], names: ['青龙丹', '太乙丹'], effects: ['spirit', 'flight'], rarity: 'epic' },
  { elements: ['water', 'wood', 'fire'], names: ['白虎丹', '离合丹'], effects: ['exorcism', 'invisibility'], rarity: 'epic' },
  { elements: ['wood', 'fire', 'earth', 'metal'], names: ['四灵丹', '万象丹'], effects: ['longevity', 'exorcism'], rarity: 'legendary' },
  { elements: ['fire', 'earth', 'metal', 'water'], names: ['混元丹', '无极丹'], effects: ['spirit', 'flight'], rarity: 'legendary' },
  { elements: ['wood', 'fire', 'earth', 'metal', 'water'], names: ['九转金丹', '太极大还丹'], effects: ['longevity', 'spirit', 'flight'], rarity: 'legendary' },
];

export const INITIAL_GOURDS: Gourd[] = [
  { color: 'purple', name: '紫金葫芦', pills: [], maxPills: 3 },
  { color: 'jade', name: '翡翠葫芦', pills: [], maxPills: 3 },
  { color: 'black', name: '黑玉葫芦', pills: [], maxPills: 3 },
];

export const GOURD_COLORS: Record<string, string> = {
  purple: '#6c3483',
  jade: '#1e8449',
  black: '#1c2833'
};

export const GOURD_GLOW: Record<string, string> = {
  purple: '#a569bd',
  jade: '#27ae60',
  black: '#566573'
};

export const LANDSCAPE_PROMPTS = [
  'ink wash painting of misty mountains with pine trees',
  'ink wash painting of waterfall and flowing river',
  'ink wash painting of ancient temple in mountains',
  'ink wash painting of bamboo forest in rain',
  'ink wash painting of lake with lotus flowers',
  'ink wash painting of cliff with hanging clouds',
];
