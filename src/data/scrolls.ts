import type { Scroll } from '../types/index.ts';

const sample = (slug: string, size: 'thumb' | 'large'): string => `/samples/${slug}-${size}.svg`;

const entry = (
  slug: string,
  name: string,
  author: string,
  dynasty: string,
  description: string,
  category: Scroll['category'],
): Scroll => ({
  id: `scroll-${slug}`,
  name,
  author,
  dynasty,
  thumbnailUrl: sample(slug, 'thumb'),
  largeImageUrl: sample(slug, 'large'),
  description,
  category,
});

/** 本地样例卷轴目录：素材走 public/samples 本地文件，id 稳定，可离线运行与离线验证 */
const scrolls: Scroll[] = [
  entry('xi-shan-xing-lv', '溪山行旅图', '范宽', '北宋', '此图描绘深山行旅之景，山势雄伟，笔墨浑厚，为北宋山水之典范。', '山水'),
  entry('fu-chun-shan-ju', '富春山居图', '黄公望', '元代', '描绘富春江两岸秀美景色，笔墨潇洒，意境深远，为元四家之代表作。', '山水'),
  entry('fu-rong-jin-ji', '芙蓉锦鸡图', '赵佶', '北宋', '此图绘芙蓉花枝上立一锦鸡，神态生动，设色典雅，为宋徽宗御笔。', '花鸟'),
  entry('mo-mei', '墨梅图', '王冕', '元代', '以水墨写意画梅，枝干遒劲，梅花清雅，尽显文人画之韵味。', '花鸟'),
  entry('han-xi-zai-ye-yan', '韩熙载夜宴图', '顾闳中', '五代', '描绘南唐大臣韩熙载夜宴宾客之情景，人物传神，细节精妙。', '人物'),
  entry('bu-nian', '步辇图', '阎立本', '唐代', '记录唐太宗接见吐蕃使者禄东赞之历史场景，人物刻画细腻生动。', '人物'),
  entry('lan-ting-ji-xu', '兰亭集序', '王羲之', '东晋', '书圣王羲之行书代表作，被誉为天下第一行书，笔势飘逸洒脱。', '书法'),
  entry('duo-bao-ta-bei', '多宝塔碑', '颜真卿', '唐代', '颜真卿楷书代表作，结构严谨，笔力雄健，为唐楷之典范。', '书法'),
];

export default scrolls;
