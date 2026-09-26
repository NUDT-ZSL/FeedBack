import { AlertTriangle } from 'lucide-react';
import { usePaletteStore, type ComponentBindingKey } from '../store';
import { meetsWcagAa, generateGradient, contrastRatio } from '../utils/colorUtils';

const ContrastWarning = ({ textColor, bgColor }: { textColor: string; bgColor: string }) => {
  const lowContrast = !meetsWcagAa(textColor, bgColor);
  const ratio = contrastRatio(textColor, bgColor).toFixed(1);

  return (
    <div className={`contrast-warning ${lowContrast ? 'visible' : ''}`}>
      <AlertTriangle color="#F59E0B" fill="#F59E0B" strokeWidth={0} />
      <div className="contrast-warning__tooltip">
        对比度不足{ratio}:1，建议调整
      </div>
    </div>
  );
};

interface PreviewItemProps {
  bindingKey: ComponentBindingKey;
  onContextMenu: (e: React.MouseEvent) => void;
}

const PreviewCard = ({ bindingKey: _bindingKey, onContextMenu }: PreviewItemProps) => {
  const getColorByTag = usePaletteStore((state) => state.getColorByTag);
  const bindings = usePaletteStore((state) => state.bindings);

  const headerColor = getColorByTag(bindings['card-header']);
  const btnColor = getColorByTag(bindings['card-button']);
  const bgColor = getColorByTag(bindings['surface-bg']);
  const textColor = getColorByTag(bindings['text-primary']);

  return (
    <div
      className="preview-card"
      style={{ backgroundColor: bgColor }}
      onContextMenu={onContextMenu}
    >
      <h3 className="preview-card__header" style={{ color: headerColor }}>
        品牌卡片标题
      </h3>
      <p className="preview-card__desc">
        这是一个预览卡片，用于展示品牌色板在真实UI组件上的视觉效果。
      </p>
      <div className="preview-card__footer">
        <button
          className="preview-card__btn"
          style={{ backgroundColor: btnColor }}
        >
          了解更多
        </button>
      </div>
      <ContrastWarning textColor={headerColor} bgColor={bgColor} />
      <ContrastWarning textColor="#FFFFFF" bgColor={btnColor} />
      <ContrastWarning textColor={textColor} bgColor={bgColor} />
    </div>
  );
};

const PreviewButton = ({ bindingKey: _bindingKey, onContextMenu }: PreviewItemProps) => {
  const getColorByTag = usePaletteStore((state) => state.getColorByTag);
  const bindings = usePaletteStore((state) => state.bindings);

  const bgColor = getColorByTag(bindings['button-bg']);

  return (
    <div
      className="preview-button"
      style={{ backgroundColor: bgColor }}
      onContextMenu={onContextMenu}
    >
      主要按钮
      <ContrastWarning textColor="#FFFFFF" bgColor={bgColor} />
    </div>
  );
};

const PreviewGradient = ({ bindingKey: _bindingKey, onContextMenu }: PreviewItemProps) => {
  const getColorByTag = usePaletteStore((state) => state.getColorByTag);
  const bindings = usePaletteStore((state) => state.bindings);

  const startColor = getColorByTag(bindings['gradient-start']);
  const endColor = getColorByTag(bindings['gradient-end']);
  const gradient = generateGradient(startColor, endColor, 45);

  return (
    <div
      className="preview-gradient"
      style={{ background: gradient }}
      onContextMenu={onContextMenu}
    >
      渐变背景效果
      <ContrastWarning textColor="#FFFFFF" bgColor={startColor} />
    </div>
  );
};

interface PreviewPanelProps {
  onComponentContextMenu: (e: React.MouseEvent, bindingKey: ComponentBindingKey) => void;
}

const PreviewPanel = ({ onComponentContextMenu }: PreviewPanelProps) => {
  return (
    <div className="preview-panel">
      <span className="preview-panel__title">实时预览</span>
      <PreviewCard
        bindingKey="card-header"
        onContextMenu={(e) => onComponentContextMenu(e, 'card-header')}
      />
      <PreviewButton
        bindingKey="button-bg"
        onContextMenu={(e) => onComponentContextMenu(e, 'button-bg')}
      />
      <PreviewGradient
        bindingKey="gradient-start"
        onContextMenu={(e) => onComponentContextMenu(e, 'gradient-start')}
      />
    </div>
  );
};

export default PreviewPanel;
