/**
 * 主页面：持有配方与光源状态（唯一数据源），
 * 左侧配置面板改参数，右侧预览面板渲染，引擎负责分层缓存与导出。
 */

import { useState } from 'react';
import ConfigPanel from '../components/ConfigPanel.tsx';
import PreviewPanel from '../components/PreviewPanel.tsx';
import { normalizeRecipe } from '../core/recipe.ts';
import { DEFAULT_RECIPE } from '../core/types.ts';
import type { LightMode, PaperRecipe } from '../core/types.ts';

const INITIAL_RECIPE: PaperRecipe = normalizeRecipe({
  ...DEFAULT_RECIPE,
  patterns: [
    { id: 'init-plum', type: 'plum', scale: 1.1, position: { x: 28, y: 22 }, rotation: 10, opacity: 0.5 },
    { id: 'init-bamboo', type: 'bamboo', scale: 1, position: { x: 72, y: 68 }, rotation: 350, opacity: 0.4 },
  ],
  inscription: { ...DEFAULT_RECIPE.inscription, text: '清风徐来' },
});

export default function Home() {
  const [recipe, setRecipe] = useState<PaperRecipe>(INITIAL_RECIPE);
  const [lightMode, setLightMode] = useState<LightMode>('daylight');

  return (
    <div className="flex min-h-screen flex-col bg-[#f5e6d3] md:flex-row">
      <ConfigPanel
        recipe={recipe}
        onChange={setRecipe}
        onReshuffleGold={() =>
          setRecipe((current) => ({
            ...current,
            goldFoil: { ...current.goldFoil, seed: current.goldFoil.seed + 1 },
          }))
        }
      />
      <PreviewPanel recipe={recipe} lightMode={lightMode} onLightModeChange={setLightMode} />
    </div>
  );
}
