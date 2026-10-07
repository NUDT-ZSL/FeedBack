import type { ToolMode } from '../types.ts';

interface ToolbarProps {
  mode: ToolMode;
  scale: number;
  selectedCardCount: number;
  outlineOpen: boolean;
  onModeChange: (mode: ToolMode) => void;
  onNewCard: () => void;
  onCreateGroup: () => void;
  onToggleOutline: () => void;
  onZoom: (factor: number) => void;
}

export default function Toolbar({
  mode,
  scale,
  selectedCardCount,
  outlineOpen,
  onModeChange,
  onNewCard,
  onCreateGroup,
  onToggleOutline,
  onZoom,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <span className="toolbar__brand">灵感板</span>
      <button type="button" className="toolbar__btn" onClick={onNewCard}>＋ 新建卡片</button>
      <button
        type="button"
        className={`toolbar__btn ${mode === 'select' ? 'toolbar__btn--active' : ''}`}
        onClick={() => onModeChange('select')}
      >
        选择
      </button>
      <button
        type="button"
        className={`toolbar__btn ${mode === 'boxSelect' ? 'toolbar__btn--active' : ''}`}
        onClick={() => onModeChange('boxSelect')}
      >
        框选
      </button>
      <button
        type="button"
        className={`toolbar__btn ${mode === 'connect' ? 'toolbar__btn--active' : ''}`}
        onClick={() => onModeChange('connect')}
      >
        连线
      </button>
      <button
        type="button"
        className="toolbar__btn"
        disabled={selectedCardCount === 0}
        title="把选中的卡片归入一个新卡组（已入组的卡片会被跳过并提示）"
        onClick={onCreateGroup}
      >
        ⊞ 新建卡组{selectedCardCount > 0 ? `（${selectedCardCount}）` : ''}
      </button>
      <button
        type="button"
        className={`toolbar__btn ${outlineOpen ? 'toolbar__btn--active' : ''}`}
        onClick={onToggleOutline}
      >
        叙事大纲
      </button>
      <div className="toolbar__zoom">
        <button type="button" className="toolbar__btn" onClick={() => onZoom(1 / 1.2)}>−</button>
        <span className="toolbar__scale">{Math.round(scale * 100)}%</span>
        <button type="button" className="toolbar__btn" onClick={() => onZoom(1.2)}>＋</button>
      </div>
    </div>
  );
}
