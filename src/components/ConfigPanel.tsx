/**
 * 配置面板：只负责编辑"参数配置"（PaperRecipe），通过 onRecipeChange 上抛。
 * 不接触渲染结果与导出产物——参数变化后由管线决定哪些层需要重算。
 */

import {
  GOLD_DENSITY_PRESETS,
  LIMITS,
  PAPER_COLORS,
  PAPER_SIZES,
  PATTERN_TYPES,
  type InscriptionConfig,
  type PaperRecipe,
  type PatternLayerConfig,
  type PatternType,
} from '@/core/types';

interface ConfigPanelProps {
  recipe: PaperRecipe;
  onRecipeChange: (next: PaperRecipe) => void;
}

let patternSeq = 100;

export default function ConfigPanel({ recipe, onRecipeChange }: ConfigPanelProps) {
  const patch = (partial: Partial<PaperRecipe>) => onRecipeChange({ ...recipe, ...partial });

  const patchPattern = (id: string, partial: Partial<PatternLayerConfig>) => {
    patch({
      patterns: recipe.patterns.map((p) => (p.id === id ? { ...p, ...partial } : p)),
    });
  };

  const addPattern = (type: PatternType) => {
    patternSeq += 1;
    const maxOrder = recipe.patterns.reduce((m, p) => Math.max(m, p.order), -1);
    patch({
      patterns: [
        ...recipe.patterns,
        {
          id: `pattern-${patternSeq}`,
          type,
          order: maxOrder + 1,
          scale: 1.2,
          position: { x: 50, y: 50 },
          rotation: 0,
          opacity: 0.45,
        },
      ],
    });
  };

  const removePattern = (id: string) => {
    patch({ patterns: recipe.patterns.filter((p) => p.id !== id) });
  };

  const movePattern = (id: string, dir: 1 | -1) => {
    const sorted = [...recipe.patterns].sort((a, b) =>
      a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1,
    );
    const index = sorted.findIndex((p) => p.id === id);
    const target = index + dir;
    if (index < 0 || target < 0 || target >= sorted.length) return;
    const next = sorted.map((p) => ({ ...p }));
    const tmp = next[index].order;
    next[index].order = next[target].order;
    next[target].order = tmp;
    if (next[index].order === next[target].order) {
      next[target].order = tmp + dir;
    }
    patch({ patterns: next });
  };

  const patchInscription = (partial: Partial<InscriptionConfig>) => {
    patch({ inscription: { ...recipe.inscription, ...partial } });
  };

  return (
    <div className="config-panel">
      <h2 className="panel-title">笺纸工坊</h2>

      <section className="config-section">
        <h3>笺纸尺寸</h3>
        <div className="option-row">
          {PAPER_SIZES.map((s) => (
            <button
              key={s.id}
              className={`wood-btn ${recipe.sizeId === s.id ? 'selected' : ''}`}
              onClick={() => patch({ sizeId: s.id })}
            >
              {s.name}
            </button>
          ))}
        </div>
      </section>

      <section className="config-section">
        <h3>宣纸底色</h3>
        <div className="swatch-grid">
          {PAPER_COLORS.map((c) => (
            <button
              key={c.id}
              title={c.name}
              className={`color-swatch ${recipe.baseColorId === c.id ? 'selected' : ''}`}
              style={{ backgroundColor: c.hex }}
              onClick={() => patch({ baseColorId: c.id })}
            >
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="config-section">
        <h3>印花纹样（自下而上叠放）</h3>
        <div className="option-row wrap">
          {PATTERN_TYPES.map((t) => (
            <button key={t.id} className="wood-btn small" onClick={() => addPattern(t.id)}>
              + {t.name}
            </button>
          ))}
        </div>
        {recipe.patterns.length === 0 && <p className="hint">尚未叠加纹样</p>}
        {[...recipe.patterns]
          .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1))
          .map((layer) => {
            const typeName = PATTERN_TYPES.find((t) => t.id === layer.type)?.name ?? layer.type;
            return (
              <div key={layer.id} className="pattern-card">
                <div className="pattern-card-head">
                  <strong>{typeName}</strong>
                  <span className="pattern-actions">
                    <button className="wood-btn tiny" onClick={() => movePattern(layer.id, -1)}>下移</button>
                    <button className="wood-btn tiny" onClick={() => movePattern(layer.id, 1)}>上移</button>
                    <button className="wood-btn tiny danger" onClick={() => removePattern(layer.id)}>移除</button>
                  </span>
                </div>
                <label>
                  大小 {layer.scale.toFixed(1)}x
                  <input
                    type="range"
                    min={LIMITS.patternScale.min}
                    max={LIMITS.patternScale.max}
                    step={0.1}
                    value={layer.scale}
                    onChange={(e) => patchPattern(layer.id, { scale: Number(e.target.value) })}
                  />
                </label>
                <label>
                  旋转 {layer.rotation}°
                  <input
                    type="range"
                    min={0}
                    max={360}
                    step={LIMITS.rotationStep}
                    value={layer.rotation}
                    onChange={(e) => patchPattern(layer.id, { rotation: Number(e.target.value) })}
                  />
                </label>
                <label>
                  透明度 {Math.round(layer.opacity * 100)}%
                  <input
                    type="range"
                    min={LIMITS.patternOpacity.min}
                    max={LIMITS.patternOpacity.max}
                    step={0.05}
                    value={layer.opacity}
                    onChange={(e) => patchPattern(layer.id, { opacity: Number(e.target.value) })}
                  />
                </label>
                <label>
                  横向 {layer.position.x}
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={layer.position.x}
                    onChange={(e) =>
                      patchPattern(layer.id, { position: { ...layer.position, x: Number(e.target.value) } })
                    }
                  />
                </label>
                <label>
                  纵向 {layer.position.y}
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={layer.position.y}
                    onChange={(e) =>
                      patchPattern(layer.id, { position: { ...layer.position, y: Number(e.target.value) } })
                    }
                  />
                </label>
              </div>
            );
          })}
      </section>

      <section className="config-section">
        <h3>洒金密度</h3>
        <div className="option-row">
          {GOLD_DENSITY_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`wood-btn ${recipe.goldFoil.density === p.value ? 'selected' : ''}`}
              onClick={() => patch({ goldFoil: { density: p.value } })}
            >
              {p.name}·{p.value}
            </button>
          ))}
        </div>
        <label>
          密度 {recipe.goldFoil.density} 片
          <input
            type="range"
            min={LIMITS.goldDensity.min}
            max={LIMITS.goldDensity.max}
            value={recipe.goldFoil.density}
            onChange={(e) => patch({ goldFoil: { density: Number(e.target.value) } })}
          />
        </label>
      </section>

      <section className="config-section">
        <h3>题字</h3>
        <input
          className="text-input"
          type="text"
          placeholder="落一款题字…"
          value={recipe.inscription.text}
          onChange={(e) => patchInscription({ text: e.target.value })}
        />
        <div className="option-row">
          <button
            className={`wood-btn ${recipe.inscription.layout === 'vertical' ? 'selected' : ''}`}
            onClick={() => patchInscription({ layout: 'vertical' })}
          >
            竖排
          </button>
          <button
            className={`wood-btn ${recipe.inscription.layout === 'horizontal' ? 'selected' : ''}`}
            onClick={() => patchInscription({ layout: 'horizontal' })}
          >
            横排
          </button>
        </div>
        <label>
          字号 {recipe.inscription.fontSize}
          <input
            type="range"
            min={LIMITS.fontSize.min}
            max={LIMITS.fontSize.max}
            value={recipe.inscription.fontSize}
            onChange={(e) => patchInscription({ fontSize: Number(e.target.value) })}
          />
        </label>
        <label>
          横向 {recipe.inscription.position.x}
          <input
            type="range"
            min={0}
            max={100}
            value={recipe.inscription.position.x}
            onChange={(e) =>
              patchInscription({ position: { ...recipe.inscription.position, x: Number(e.target.value) } })
            }
          />
        </label>
        <label>
          纵向 {recipe.inscription.position.y}
          <input
            type="range"
            min={0}
            max={100}
            value={recipe.inscription.position.y}
            onChange={(e) =>
              patchInscription({ position: { ...recipe.inscription.position, y: Number(e.target.value) } })
            }
          />
        </label>
      </section>
    </div>
  );
}
