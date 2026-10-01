import { v4 as uuidv4 } from 'uuid';
import type { Character, RadicalGroup } from '../types';

export const RADICAL_GROUPS: RadicalGroup[] = [
  {
    radical: '金',
    name: '金部',
    characters: [
      '金', '银', '铜', '铁', '锡', '铅', '钱', '钟', '铃', '镜',
      '锣', '锅', '针', '钉', '链', '锁', '钥', '锋', '锐', '错'
    ]
  },
  {
    radical: '木',
    name: '木部',
    characters: [
      '木', '林', '森', '树', '枝', '叶', '根', '杆', '板', '柜',
      '桌', '椅', '床', '柜', '门', '窗', '桌', '桥', '楼', '梯'
    ]
  },
  {
    radical: '水',
    name: '水部',
    characters: [
      '水', '江', '河', '湖', '海', '洋', '波', '浪', '流', '溪',
      '泉', '冰', '雪', '雨', '云', '雾', '露', '霜', '泪', '汗'
    ]
  },
  {
    radical: '火',
    name: '火部',
    characters: [
      '火', '炎', '焰', '烧', '烤', '煮', '蒸', '炒', '炸', '灯',
      '烛', '炉', '炭', '烟', '灰', '热', '光', '明', '星', '晴'
    ]
  },
  {
    radical: '土',
    name: '土部',
    characters: [
      '土', '地', '山', '石', '田', '坡', '岭', '峰', '崖', '谷',
      '沙', '尘', '泥', '砖', '瓦', '墙', '城', '堡', '塔', '坟'
    ]
  },
  {
    radical: '人',
    name: '人部',
    characters: [
      '人', '大', '小', '上', '下', '中', '天', '日', '月', '年',
      '春', '夏', '秋', '冬', '东', '西', '南', '北', '前', '后'
    ]
  }
];

export function generateCharacters(): Character[] {
  const characters: Character[] = [];
  
  RADICAL_GROUPS.forEach(group => {
    group.characters.forEach(char => {
      characters.push({
        id: uuidv4(),
        char,
        radical: group.radical,
        radicalName: group.name
      });
    });
  });
  
  return characters;
}

export const ALL_CHARACTERS = generateCharacters();

export function getCharactersByRadical(radical: string): Character[] {
  return ALL_CHARACTERS.filter(c => c.radical === radical);
}
