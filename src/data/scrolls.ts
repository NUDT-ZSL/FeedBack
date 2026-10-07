import type { Scroll } from '../types';

// 卷轴素材全部走本地样例，收藏推导与页面渲染不依赖网络请求。
const sampleUrl = (file: string): string => `/samples/${file}.svg`;

const scrolls: Scroll[] = [
  {
    id: 'scroll-xishan',
    name: '溪山行旅图',
    author: '范宽',
    dynasty: '北宋',
    thumbnailUrl: sampleUrl('xishan'),
    largeImageUrl: sampleUrl('xishan'),
    description: '此图描绘深山行旅之景，山势雄伟，笔墨浑厚，为北宋山水之典范。',
    category: '山水',
  },
  {
    id: 'scroll-fuchun',
    name: '富春山居图',
    author: '黄公望',
    dynasty: '元代',
    thumbnailUrl: sampleUrl('fuchun'),
    largeImageUrl: sampleUrl('fuchun'),
    description: '描绘富春江两岸秀美景色，笔墨潇洒，意境深远，为元四家之代表作。',
    category: '山水',
  },
  {
    id: 'scroll-jinji',
    name: '芙蓉锦鸡图',
    author: '赵佶',
    dynasty: '北宋',
    thumbnailUrl: sampleUrl('jinji'),
    largeImageUrl: sampleUrl('jinji'),
    description: '此图绘芙蓉花枝上立一锦鸡，神态生动，设色典雅，为宋徽宗御笔。',
    category: '花鸟',
  },
  {
    id: 'scroll-momei',
    name: '墨梅图',
    author: '王冕',
    dynasty: '元代',
    thumbnailUrl: sampleUrl('momei'),
    largeImageUrl: sampleUrl('momei'),
    description: '以水墨写意画梅，枝干遒劲，梅花清雅，尽显文人画之韵味。',
    category: '花鸟',
  },
  {
    id: 'scroll-yeyan',
    name: '韩熙载夜宴图',
    author: '顾闳中',
    dynasty: '五代',
    thumbnailUrl: sampleUrl('yeyan'),
    largeImageUrl: sampleUrl('yeyan'),
    description: '描绘南唐大臣韩熙载夜宴宾客之情景，人物传神，细节精妙。',
    category: '人物',
  },
  {
    id: 'scroll-bunian',
    name: '步辇图',
    author: '阎立本',
    dynasty: '唐代',
    thumbnailUrl: sampleUrl('bunian'),
    largeImageUrl: sampleUrl('bunian'),
    description: '记录唐太宗接见吐蕃使者禄东赞之历史场景，人物刻画细腻生动。',
    category: '人物',
  },
  {
    id: 'scroll-lanting',
    name: '兰亭集序',
    author: '王羲之',
    dynasty: '东晋',
    thumbnailUrl: sampleUrl('lanting'),
    largeImageUrl: sampleUrl('lanting'),
    description: '书圣王羲之行书代表作，被誉为天下第一行书，笔势飘逸洒脱。',
    category: '书法',
  },
  {
    id: 'scroll-duobao',
    name: '多宝塔碑',
    author: '颜真卿',
    dynasty: '唐代',
    thumbnailUrl: sampleUrl('duobao'),
    largeImageUrl: sampleUrl('duobao'),
    description: '颜真卿楷书代表作，结构严谨，笔力雄健，为唐楷之典范。',
    category: '书法',
  },
];

export default scrolls;
