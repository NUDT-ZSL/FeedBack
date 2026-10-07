/**
 * 主页面：组装 参数配置 / 分层渲染管线 / 预览 / 导出 四段边界。
 *
 * 数据流向（与 TECH 文档一致）：
 *   ConfigPanel.onRecipeChange → 更新 PaperRecipe（配置快照）
 *     → PaperPipeline.update（仅重算受影响的层）
 *       → PreviewPanel 绘制分层结果（光源为罩层，不入层）
 *         → 入匣：PaperPipeline.export 取不可变导出产物 → PNG / 文案 / 剪贴板
 */

import { useMemo, useRef, useState } from 'react';
import ConfigPanel from '@/components/ConfigPanel';
import PreviewPanel from '@/components/PreviewPanel';
import { paintOps, type PaintContext } from '@/core/displayList';
import { PaperPipeline } from '@/core/pipeline';
import { EXPORT_HEIGHT, EXPORT_WIDTH, type ExportArtifact } from '@/core/exporter';
import { defaultRecipe } from '@/core/recipe';
import type { LightMode, PaperRecipe } from '@/core/types';

export default function Home() {
  const [recipe, setRecipe] = useState<PaperRecipe>(() => defaultRecipe());
  const [lightMode, setLightMode] = useState<LightMode>('daylight');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [artifact, setArtifact] = useState<ExportArtifact | null>(null);
  const pipelineRef = useRef<PaperPipeline | null>(null);
  if (pipelineRef.current === null) pipelineRef.current = new PaperPipeline();

  const result = useMemo(() => pipelineRef.current!.update(recipe), [recipe]);

  // 墨滴涟漪：纯展示反馈，不触碰任何渲染/导出状态
  const spawnRipple = (event: React.MouseEvent) => {
    const el = document.createElement('span');
    el.className = 'ink-ripple';
    el.style.left = `${event.clientX}px`;
    el.style.top = `${event.clientY}px`;
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 400);
  };

  const handleExport = () => {
    const box = pipelineRef.current!.export(lightMode);
    const canvas = document.createElement('canvas');
    canvas.width = EXPORT_WIDTH;
    canvas.height = EXPORT_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (ctx) paintOps(ctx as unknown as PaintContext, box.ops);
    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `jianzhi-${box.hash}.png`;
        link.click();
        URL.revokeObjectURL(url);
      }
      // 复制图片到剪贴板（不支持时静默降级）
      if (blob && navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(() => undefined);
      }
    }, 'image/png');
    setArtifact(box);
  };

  return (
    <div className="workshop" onClickCapture={spawnRipple}>
      <button className="hamburger wood-btn" onClick={() => setDrawerOpen((v) => !v)} aria-label="展开配置">
        ☰
      </button>

      <aside className={`config-drawer ${drawerOpen ? 'open' : ''}`}>
        <ConfigPanel
          recipe={recipe}
          onRecipeChange={setRecipe}
        />
      </aside>

      <main className="workspace">
        <PreviewPanel
          result={result}
          lightMode={lightMode}
          onLightModeChange={setLightMode}
          onExport={handleExport}
        />
        <div className="recipe-meta">
          纸面内容哈希 <code>{result.hash}</code>
          {artifact && <> · 最近入匣 <code>{artifact.hash}</code></>}
        </div>

        {artifact && (
          <div className="share-modal" onClick={() => setArtifact(null)}>
            <div className="share-card" onClick={(e) => e.stopPropagation()}>
              <h3>已装入木匣（600×800 PNG）</h3>
              <p>{artifact.shareText}</p>
              <div className="share-actions">
                <button className="wood-btn primary" onClick={() => void navigator.clipboard?.writeText(artifact.shareText)}>
                  复制文案
                </button>
                <button className="wood-btn" onClick={() => setArtifact(null)}>收起</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
