import { SkillConfig } from '../src/types';

export const PRESET_SKILLS: SkillConfig[] = [
  {
    id: 'fireball',
    name: '火焰弹',
    type: 'fire',
    damage: 35,
    cooldown: 2,
    cost: 15,
    color: '#ff5252',
  },
  {
    id: 'frost-nova',
    name: '冰霜新星',
    type: 'ice',
    damage: 28,
    cooldown: 3,
    cost: 20,
    color: '#448aff',
  },
  {
    id: 'heal-wave',
    name: '治愈波',
    type: 'heal',
    damage: 40,
    cooldown: 4,
    cost: 25,
    color: '#69f0ae',
  },
  {
    id: 'lightning-chain',
    name: '闪电链',
    type: 'lightning',
    damage: 45,
    cooldown: 4,
    cost: 30,
    color: '#e040fb',
  },
  {
    id: 'shield-charge',
    name: '护盾冲锋',
    type: 'shield',
    damage: 20,
    cooldown: 3,
    cost: 18,
    color: '#ffab40',
  },
];
