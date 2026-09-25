import type { ShapeKind, TextureKind } from './types';

export interface PromptHints {
  themeName?: string;
  shapes?: ShapeKind[];
  texture?: TextureKind;
}

const THEME_KEYWORDS: ReadonlyArray<[string, string[]]> = [
  ['cyberpunk', ['赛博', '霓虹', 'cyberpunk', 'neon', '朋克']],
  ['morandi', ['莫兰迪', 'morandi', '低饱和', '灰调', 'muted']],
  ['forest', ['森林', 'forest', '自然', 'nature', '树']],
  ['sunset', ['日落', 'sunset', '黄昏', '夕阳', '温暖', 'warm']],
  ['ocean', ['海浪', '海', 'ocean', 'wave', '蓝色', 'blue']],
];

const SHAPE_KEYWORDS: ReadonlyArray<[ShapeKind, string[]]> = [
  ['circle', ['圆', 'circle', 'round', '球']],
  ['triangle', ['三角', 'triangle', '棱']],
  ['wave', ['波', 'wave', '浪', '流动']],
  ['rectangle', ['方', '矩形', 'rectangle', 'square']],
];

const TEXTURE_KEYWORDS: ReadonlyArray<[TextureKind, string[]]> = [
  ['smooth', ['平滑', 'smooth', '丝滑']],
  ['grainy', ['颗粒', 'grainy', '噪点', 'noise']],
  ['gradient', ['渐变', 'gradient', '过渡']],
];

/**
 * 解析 prompt 中的颜色 / 形状 / 纹理关键词。
 * 纯函数：同一 prompt 永远得到同一结果，未命中维度返回 undefined 由调用方兜底。
 */
export function parsePrompt(prompt: string): PromptHints {
  const text = prompt.toLowerCase();
  const hints: PromptHints = {};
  for (const [themeName, keywords] of THEME_KEYWORDS) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      hints.themeName = themeName;
      break;
    }
  }
  const shapes = SHAPE_KEYWORDS.filter(([, keywords]) =>
    keywords.some((keyword) => text.includes(keyword)),
  ).map(([shape]) => shape);
  if (shapes.length > 0) {
    hints.shapes = shapes;
  }
  for (const [texture, keywords] of TEXTURE_KEYWORDS) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      hints.texture = texture;
      break;
    }
  }
  return hints;
}
