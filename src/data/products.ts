import { Product } from '../types';

const origins = [
  '厄瓜多尔', '加纳', '马达加斯加', '委内瑞拉', '秘鲁',
  '多米尼加', '坦桑尼亚', '乌干达', '洪都拉斯', '哥伦比亚',
  '巴西', '科特迪瓦', '玻利维亚', '所罗门群岛', '巴布亚新几内亚'
];

const flavorTagSets = [
  ['浓郁', '烟熏', '木香'],
  ['花香', '浆果', '蜂蜜'],
  ['果酸', '柑橘', '莓果'],
  ['坚果', '焦糖', '奶油'],
  ['香料', '肉桂', '丁香'],
  ['果香', '覆盆子', '樱桃'],
  ['木质', '雪松', '烟草'],
  ['奶油', '香草', '牛奶'],
  ['果香', '橙子', '柠檬'],
  ['花香', '茉莉', '玫瑰']
];

const names = [
  '暗夜交响曲', '金箔月光', '森林秘境', '焦糖华尔兹',
  '晨曦初露', '红宝石之吻', '黑森林回声', '沙漠玫瑰',
  '海洋之梦', '星尘奇迹', '丝绒黄昏', '珍珠芭蕾',
  '琥珀之心', '翡翠之约', '紫晶涟漪', '银河流浪',
  '冬日暖阳', '夏日微风', '秋日私语', '春日萌动'
];

const descriptions = [
  '源自单一产区的精品可可，经大师手工调制',
  '采用传统石磨工艺，保留可可原始风味',
  '稀有可可豆品种，限量发售珍藏级巧克力',
  '融合花果香气，层次丰富令人回味无穷',
  '72小时慢研工艺，极致丝滑口感体验'
];

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function generateImagePrompt(seed: number, name: string, origin: string, cocoa: number): string {
  const rnd = seededRandom(seed);
  const styles = ['artistic chocolate bar', 'handcrafted truffle', 'premium chocolate square', 'elegant bonbon collection'];
  const style = styles[Math.floor(rnd() * styles.length)];
  const palettes = ['dark brown and gold', 'rich burgundy and cream', 'deep mahogany and bronze', 'chocolate and amber'];
  const palette = palettes[Math.floor(rnd() * palettes.length)];
  return `premium ${style}, ${name}, origin ${origin}, ${cocoa}% cocoa content, luxurious photography, ${palette} color palette, studio lighting, macro detail, 45 degree angle view, elegant packaging background, professional food photography, high resolution`;
}

function generateImageUrl(prompt: string): string {
  return `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encodeURIComponent(prompt)}&image_size=square_hd`;
}

export function generateProducts(count: number = 50): Product[] {
  const rnd = seededRandom(42);
  const products: Product[] = [];

  for (let i = 0; i < count; i++) {
    const seed = i + 1;
    const cocoaOptions = [55, 60, 65, 70, 72, 75, 80, 85, 90];
    const cocoa = cocoaOptions[Math.floor(rnd() * cocoaOptions.length)];
    const origin = origins[Math.floor(rnd() * origins.length)];
    const flavorTags = flavorTagSets[Math.floor(rnd() * flavorTagSets.length)];
    const name = names[i % names.length] + (i >= names.length ? ` · ${String(Math.floor(i / names.length) + 1)}号` : '');
    const price = Math.round((28 + rnd() * 50) * 100) / 100;
    const description = descriptions[i % descriptions.length];
    const prompt = generateImagePrompt(seed, name, origin, cocoa);

    products.push({
      id: `prod_${String(i + 1).padStart(6, '0')}`,
      name,
      origin,
      cocoaContent: cocoa,
      imageUrl: generateImageUrl(prompt),
      flavorTags: [...flavorTags],
      price,
      description
    });
  }

  return products;
}

export const products: Product[] = generateProducts(50);

export function getProductById(id: string): Product | undefined {
  return products.find(p => p.id === id);
}

export function getProductsByIds(ids: string[]): Product[] {
  return ids.map(id => getProductById(id)).filter((p): p is Product => p !== undefined);
}
