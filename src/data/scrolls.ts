import { v4 as uuidv4 } from 'uuid';
import type { Scroll } from '../types';

const createImageUrl = (prompt: string, size: 'square' | 'landscape_16_9'): string => {
  const encodedPrompt = encodeURIComponent(prompt);
  return `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encodedPrompt}&image_size=${size}`;
};

const scrolls: Scroll[] = [
  {
    id: uuidv4(),
    name: '溪山行旅图',
    author: '范宽',
    dynasty: '北宋',
    thumbnailUrl: createImageUrl('北宋山水画，范宽风格，高山流水，古树参天，行旅人物，水墨古画风格', 'square'),
    largeImageUrl: createImageUrl('北宋山水画，范宽风格，高山流水，古树参天，行旅人物，水墨古画风格', 'landscape_16_9'),
    description: '此图描绘深山行旅之景，山势雄伟，笔墨浑厚，为北宋山水之典范。',
    category: '山水',
  },
  {
    id: uuidv4(),
    name: '富春山居图',
    author: '黄公望',
    dynasty: '元代',
    thumbnailUrl: createImageUrl('元代山水画，黄公望风格，富春江景色，水墨山水，长卷构图，古画风格', 'square'),
    largeImageUrl: createImageUrl('元代山水画，黄公望风格，富春江景色，水墨山水，长卷构图，古画风格', 'landscape_16_9'),
    description: '描绘富春江两岸秀美景色，笔墨潇洒，意境深远，为元四家之代表作。',
    category: '山水',
  },
  {
    id: uuidv4(),
    name: '芙蓉锦鸡图',
    author: '赵佶',
    dynasty: '北宋',
    thumbnailUrl: createImageUrl('宋代花鸟画，赵佶风格，芙蓉花，锦鸡，工笔重彩，古画风格', 'square'),
    largeImageUrl: createImageUrl('宋代花鸟画，赵佶风格，芙蓉花，锦鸡，工笔重彩，古画风格', 'landscape_16_9'),
    description: '此图绘芙蓉花枝上立一锦鸡，神态生动，设色典雅，为宋徽宗御笔。',
    category: '花鸟',
  },
  {
    id: uuidv4(),
    name: '墨梅图',
    author: '王冕',
    dynasty: '元代',
    thumbnailUrl: createImageUrl('元代花鸟画，王冕风格，墨梅，水墨写意，梅花枝干，古画风格', 'square'),
    largeImageUrl: createImageUrl('元代花鸟画，王冕风格，墨梅，水墨写意，梅花枝干，古画风格', 'landscape_16_9'),
    description: '以水墨写意画梅，枝干遒劲，梅花清雅，尽显文人画之韵味。',
    category: '花鸟',
  },
  {
    id: uuidv4(),
    name: '韩熙载夜宴图',
    author: '顾闳中',
    dynasty: '五代',
    thumbnailUrl: createImageUrl('五代人物画，顾闳中风格，夜宴场景，人物众多，工笔重彩，古画风格', 'square'),
    largeImageUrl: createImageUrl('五代人物画，顾闳中风格，夜宴场景，人物众多，工笔重彩，古画风格', 'landscape_16_9'),
    description: '描绘南唐大臣韩熙载夜宴宾客之情景，人物传神，细节精妙。',
    category: '人物',
  },
  {
    id: uuidv4(),
    name: '步辇图',
    author: '阎立本',
    dynasty: '唐代',
    thumbnailUrl: createImageUrl('唐代人物画，阎立本风格，唐太宗步辇，禄东赞朝见，工笔重彩，古画风格', 'square'),
    largeImageUrl: createImageUrl('唐代人物画，阎立本风格，唐太宗步辇，禄东赞朝见，工笔重彩，古画风格', 'landscape_16_9'),
    description: '记录唐太宗接见吐蕃使者禄东赞之历史场景，人物刻画细腻生动。',
    category: '人物',
  },
  {
    id: uuidv4(),
    name: '兰亭集序',
    author: '王羲之',
    dynasty: '东晋',
    thumbnailUrl: createImageUrl('东晋书法，王羲之风格，行书，兰亭序，墨宝，古书法风格', 'square'),
    largeImageUrl: createImageUrl('东晋书法，王羲之风格，行书，兰亭序，墨宝，古书法风格', 'landscape_16_9'),
    description: '书圣王羲之行书代表作，被誉为天下第一行书，笔势飘逸洒脱。',
    category: '书法',
  },
  {
    id: uuidv4(),
    name: '多宝塔碑',
    author: '颜真卿',
    dynasty: '唐代',
    thumbnailUrl: createImageUrl('唐代书法，颜真卿风格，楷书，多宝塔碑，颜体，古书法风格', 'square'),
    largeImageUrl: createImageUrl('唐代书法，颜真卿风格，楷书，多宝塔碑，颜体，古书法风格', 'landscape_16_9'),
    description: '颜真卿楷书代表作，结构严谨，笔力雄健，为唐楷之典范。',
    category: '书法',
  },
];

export default scrolls;
