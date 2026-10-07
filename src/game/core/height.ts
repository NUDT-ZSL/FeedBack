/**
 * 药谷地形高度函数：从 TerrainGenerator 提取的纯函数版本，
 * 游戏渲染与离线验证共用同一定义，保证验证结论对真实地形有效。
 */
export function createValleyHeightFunction(size: number): (x: number, z: number) => number {
  return (x: number, z: number): number => {
    let height = 0;

    height += Math.sin(x * 0.05) * Math.cos(z * 0.05) * 2;
    height += Math.sin(x * 0.02 + 1) * Math.cos(z * 0.03) * 3;
    height += Math.sin(x * 0.1) * 0.5;

    const distFromCenter = Math.sqrt(x * x + z * z);
    if (distFromCenter > size * 0.35) {
      height += (distFromCenter - size * 0.35) * 0.15;
    }

    return height;
  };
}
