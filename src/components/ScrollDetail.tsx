import { memo, useMemo } from 'react';
import { sealComponents } from '../utils/sealShapes.tsx';
import {
  SEAL_SHAPES,
  SEAL_COLORS,
  SEAL_CHARACTER_BY_SHAPE,
  SEAL_ROTATION_MIN,
  SEAL_ROTATION_MAX,
  SEAL_POSITION_MIN,
  SEAL_POSITION_MAX,
  COLOPHON_MAX_LENGTH,
  type Scroll,
  type SealShape,
  type SealColor,
} from '../types/index.ts';
import type { DerivedEntry } from '../collection/domain/derive.ts';

export interface SealDraft {
  shape: SealShape;
  color: SealColor;
  rotation: number;
  position: { x: number; y: number };
}

interface ScrollDetailProps {
  scroll: Scroll;
  entry: DerivedEntry | null;
  collected: boolean;
  onClose: () => void;
  onCollect: () => void;
  onRemove: () => void;
  onColophonChange: (colophon: string) => void;
  onSealChange: (seal: SealDraft | null) => void;
}

const DEFAULT_SEAL: SealDraft = {
  shape: 'square',
  color: '#c0392b',
  rotation: 0,
  position: { x: 0.82, y: 0.78 },
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function SealStage({ draft, imageUrl }: { draft: SealDraft | null; imageUrl: string }) {
  if (!draft) return null;
  const SealComponent = sealComponents[draft.shape];
  return (
    <div
      style={{
        position: 'absolute',
        left: `${draft.position.x * 100}%`,
        top: `${draft.position.y * 100}%`,
        transform: `translate(-50%, -50%) rotate(${draft.rotation}deg)`,
        transition: 'left .15s, top .15s, transform .15s',
        pointerEvents: 'none',
        opacity: 0.92,
      }}
    >
      <SealComponent color={draft.color} size={56} />
      <img src={imageUrl} alt="" hidden />
    </div>
  );
}

const SealPicker = memo(function SealPicker({
  draft,
  onChange,
}: {
  draft: SealDraft | null;
  onChange: (draft: SealDraft | null) => void;
}) {
  const current = draft ?? DEFAULT_SEAL;
  const patch = (partial: Partial<SealDraft>) => onChange({ ...current, ...partial });
  const patchPosition = (axis: 'x' | 'y', value: number) =>
    onChange({ ...current, position: { ...current.position, [axis]: value } });

  return (
    <div className="seal-picker">
      <div className="seal-shapes">
        {SEAL_SHAPES.map((shape) => {
          const SealComponent = sealComponents[shape];
          return (
            <button
              key={shape}
              type="button"
              title={`${SEAL_CHARACTER_BY_SHAPE[shape]}（${shape}）`}
              className={draft?.shape === shape ? 'seal-option selected' : 'seal-option'}
              onClick={() => draft && patch({ shape })}
              disabled={!draft}
            >
              <SealComponent color={draft?.color ?? '#c0392b'} size={40} />
            </button>
          );
        })}
      </div>
      <div className="seal-colors">
        {SEAL_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`印章颜色 ${color}`}
            className={draft?.color === color ? 'seal-color selected' : 'seal-color'}
            style={{ backgroundColor: color }}
            onClick={() => draft && patch({ color })}
            disabled={!draft}
          />
        ))}
      </div>
      <label className="seal-range">
        旋转 {current.rotation}°
        <input
          type="range"
          min={SEAL_ROTATION_MIN}
          max={SEAL_ROTATION_MAX}
          value={draft ? draft.rotation : 0}
          disabled={!draft}
          onChange={(e) => patch({ rotation: clamp(Number(e.target.value), SEAL_ROTATION_MIN, SEAL_ROTATION_MAX) })}
        />
      </label>
      <label className="seal-range">
        横向位置 {current.position.x.toFixed(2)}
        <input
          type="range"
          min={SEAL_POSITION_MIN}
          max={SEAL_POSITION_MAX}
          step={0.01}
          value={draft ? draft.position.x : DEFAULT_SEAL.position.x}
          disabled={!draft}
          onChange={(e) => patchPosition('x', clamp(Number(e.target.value), SEAL_POSITION_MIN, SEAL_POSITION_MAX))}
        />
      </label>
      <label className="seal-range">
        纵向位置 {current.position.y.toFixed(2)}
        <input
          type="range"
          min={SEAL_POSITION_MIN}
          max={SEAL_POSITION_MAX}
          step={0.01}
          value={draft ? draft.position.y : DEFAULT_SEAL.position.y}
          disabled={!draft}
          onChange={(e) => patchPosition('y', clamp(Number(e.target.value), SEAL_POSITION_MIN, SEAL_POSITION_MAX))}
        />
      </label>
      {draft && (
        <button type="button" className="link-btn" onClick={() => onChange(null)}>
          撤去印章
        </button>
      )}
    </div>
  );
});

export default function ScrollDetail({
  scroll,
  entry,
  collected,
  onClose,
  onCollect,
  onRemove,
  onColophonChange,
  onSealChange,
}: ScrollDetailProps) {
  const draft: SealDraft | null = useMemo(() => {
    if (!entry?.seal) return null;
    return {
      shape: entry.seal.shape,
      color: entry.seal.color,
      rotation: entry.seal.rotation,
      position: { ...entry.seal.position },
    };
  }, [entry]);

  const colophon = entry?.colophon ?? '';
  const issues = entry?.issues ?? [];

  return (
    <aside className="detail-panel">
      <header className="detail-header">
        <div>
          <h3>{scroll.name}</h3>
          <p>{scroll.dynasty} · {scroll.author} · {scroll.category}</p>
        </div>
        <button type="button" className="close-btn" onClick={onClose} aria-label="关闭详情">×</button>
      </header>

      <div className="detail-image scroll-unroll">
        <img src={scroll.largeImageUrl} alt={scroll.name} />
        <SealStage draft={draft} imageUrl={scroll.largeImageUrl} />
        {collected && (
          <div className="detail-colophon brush-write" aria-label="题跋">
            {colophon
              ? Array.from(colophon).map((char, i) => <span key={i}>{char}</span>)
              : <span className="empty-hint">（尚无题跋）</span>}
          </div>
        )}
      </div>

      <p className="detail-desc">{scroll.description}</p>

      {collected ? (
        <div className="detail-form">
          <label>
            题跋（{Array.from(colophon).length}/{COLOPHON_MAX_LENGTH}）
            <textarea
              value={colophon}
              maxLength={COLOPHON_MAX_LENGTH}
              rows={3}
              placeholder="为这幅卷轴题写跋文……"
              onChange={(e) => onColophonChange(e.target.value.slice(0, COLOPHON_MAX_LENGTH))}
            />
          </label>
          <div className="seal-row">
            <span>钤印</span>
            {!draft && (
              <button type="button" className="btn-g small" onClick={() => onSealChange(DEFAULT_SEAL)}>
                钤盖印章
              </button>
            )}
          </div>
          <SealPicker draft={draft} onChange={onSealChange} />
          {issues.length > 0 && (
            <ul className="issue-list" aria-label="裁决记录">
              {issues.map((issue, i) => (
                <li key={`${issue.code}-${i}`} className={`issue issue-${issue.severity}`}>
                  <code>{issue.code}</code> — {issue.resolution}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn-g ghost" onClick={onRemove}>移出收藏</button>
        </div>
      ) : (
        <button type="button" className="btn-g" onClick={onCollect}>入藏</button>
      )}
    </aside>
  );
}
