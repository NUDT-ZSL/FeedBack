import { useEffect, useRef } from 'react';
import { PRESET_SWATCHES, type SemanticTag, type ComponentBindingKey, usePaletteStore } from '../store';

interface BindingMenuProps {
  x: number;
  y: number;
  componentKey: ComponentBindingKey;
  onClose: () => void;
}

const COMPONENT_LABELS: Record<ComponentBindingKey, string> = {
  'card-header': '卡片标题',
  'card-button': '卡片按钮',
  'button-bg': '主按钮背景',
  'gradient-start': '渐变起始',
  'gradient-end': '渐变结束',
  'text-primary': '主要文字',
  'surface-bg': '表面背景'
};

const BindingMenu = ({ x, y, componentKey, onClose }: BindingMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const { bindings, setSemanticBinding, getColorByTag } = usePaletteStore();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleSelect = (tag: SemanticTag) => {
    setSemanticBinding(componentKey, tag);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="binding-menu"
      style={{ left: x, top: y }}
    >
      <div className="binding-menu__title">
        绑定 {COMPONENT_LABELS[componentKey]}
      </div>
      {PRESET_SWATCHES.map((preset) => (
        <div
          key={preset.tag}
          className="binding-menu__item"
          onClick={() => handleSelect(preset.tag)}
        >
          <span
            className="binding-menu__dot"
            style={{ backgroundColor: getColorByTag(preset.tag) }}
          />
          <span>
            {preset.name}
            {bindings[componentKey] === preset.tag && ' ✓'}
          </span>
        </div>
      ))}
    </div>
  );
};

export default BindingMenu;
