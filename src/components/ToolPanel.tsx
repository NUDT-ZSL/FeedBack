import TemplateList from './TemplateList';
import { CardElement, Template, FONTS, COLORS, ElementType, EMOJI_MAP } from '../types';
import { RgbaStringColorPicker } from 'react-colorful';

interface ToolPanelProps {
  templates: Template[];
  currentTemplateId: string;
  selectedElement: CardElement | null;
  backgroundColor: string;
  onAddElement: (type: ElementType) => void;
  onApplyTemplate: (template: Template) => void;
  onUpdateElement: (id: string, updates: Partial<CardElement>) => void;
  onDeleteElement: (id: string) => void;
  onSetBackground: (color: string) => void;
  onExport: () => void;
  onCloseDrawer: () => void;
}

export default function ToolPanel(props: ToolPanelProps) {
  const {
    templates, currentTemplateId, selectedElement, backgroundColor,
    onAddElement, onApplyTemplate, onUpdateElement, onDeleteElement,
    onSetBackground, onExport, onCloseDrawer,
  } = props;

  const elementTypes: ElementType[] = ['text', 'balloon', 'cake', 'star', 'heart', 'gift'];
  const elementLabels: Record<ElementType, string> = {
    text: '文字',
    balloon: '气球',
    cake: '蛋糕',
    star: '星星',
    heart: '爱心',
    gift: '礼物',
  };

  return (
    <>
      <div className="tool-section">
        <div className="tool-section-title">📝 添加元素</div>
        <div className="element-buttons">
          {elementTypes.map(type => (
            <button
              key={type}
              className="element-btn"
              onClick={() => { onAddElement(type); onCloseDrawer(); }}
            >
              <span className="emoji">{type === 'text' ? 'T' : EMOJI_MAP[type]}</span>
              <span>{elementLabels[type]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="tool-section">
        <div className="tool-section-title">🎨 模板选择</div>
        <TemplateList
          onSelect={(t) => { onApplyTemplate(t); onCloseDrawer(); }}
          currentId={currentTemplateId}
          compact={true}
        />
      </div>

      <div className="tool-section">
        <div className="tool-section-title">🎨 背景颜色</div>
        <div className="color-picker-wrapper" style={{ padding: '0', border: 'none' }}>
          <RgbaStringColorPicker
            color={backgroundColor.startsWith('linear') ? '#FFFFFF' : backgroundColor}
            onChange={onSetBackground}
            style={{ width: '100%', height: '150px' }}
          />
        </div>
        <div className="color-grid">
          {COLORS.map(color => (
            <div
              key={color}
              className={`color-swatch ${backgroundColor === color ? 'active' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => onSetBackground(color)}
            />
          ))}
        </div>
      </div>

      {selectedElement && (
        <div className="tool-section">
          <div className="tool-section-title">
            ⚙️ {elementLabels[selectedElement.type]} 属性
          </div>

          {selectedElement.type === 'text' && (
            <>
              <div className="form-group">
                <label>字体</label>
                <select
                  value={selectedElement.fontFamily || ''}
                  onChange={(e) => onUpdateElement(selectedElement.id, { fontFamily: e.target.value })}
                >
                  {FONTS.map(f => (
                    <option key={f.value} value={f.value}>{f.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>字号: {selectedElement.fontSize}px</label>
                <input
                  type="range"
                  min="12"
                  max="96"
                  value={selectedElement.fontSize || 24}
                  onChange={(e) => onUpdateElement(selectedElement.id, { fontSize: Number(e.target.value) })}
                />
              </div>

              <div className="form-group">
                <label>文字颜色</label>
                <div className="color-grid">
                  {COLORS.map(color => (
                    <div
                      key={color}
                      className={`color-swatch ${selectedElement.fontColor === color ? 'active' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => onUpdateElement(selectedElement.id, { fontColor: color })}
                    />
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>阴影 X 偏移: {selectedElement.shadow?.offsetX || 0}px</label>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  value={selectedElement.shadow?.offsetX || 0}
                  onChange={(e) => onUpdateElement(selectedElement.id, {
                    shadow: {
                      offsetX: Number(e.target.value),
                      offsetY: selectedElement.shadow?.offsetY || 0,
                      blur: selectedElement.shadow?.blur || 0,
                      color: selectedElement.shadow?.color || 'rgba(0,0,0,0.3)',
                    }
                  })}
                />
              </div>

              <div className="form-group">
                <label>阴影 Y 偏移: {selectedElement.shadow?.offsetY || 0}px</label>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  value={selectedElement.shadow?.offsetY || 0}
                  onChange={(e) => onUpdateElement(selectedElement.id, {
                    shadow: {
                      offsetX: selectedElement.shadow?.offsetX || 0,
                      offsetY: Number(e.target.value),
                      blur: selectedElement.shadow?.blur || 0,
                      color: selectedElement.shadow?.color || 'rgba(0,0,0,0.3)',
                    }
                  })}
                />
              </div>

              <div className="form-group">
                <label>阴影模糊: {selectedElement.shadow?.blur || 0}px</label>
                <input
                  type="range"
                  min="0"
                  max="30"
                  value={selectedElement.shadow?.blur || 0}
                  onChange={(e) => onUpdateElement(selectedElement.id, {
                    shadow: {
                      offsetX: selectedElement.shadow?.offsetX || 0,
                      offsetY: selectedElement.shadow?.offsetY || 0,
                      blur: Number(e.target.value),
                      color: selectedElement.shadow?.color || 'rgba(0,0,0,0.3)',
                    }
                  })}
                />
              </div>

              <div className="form-group">
                <label>文字内容</label>
                <input
                  type="text"
                  value={selectedElement.content || ''}
                  onChange={(e) => onUpdateElement(selectedElement.id, { content: e.target.value })}
                  placeholder="双击卡片上的文字也可编辑"
                />
              </div>
            </>
          )}

          <div className="form-group">
            <label>旋转: {Math.round(selectedElement.rotation)}°</label>
            <input
              type="range"
              min="-180"
              max="180"
              value={selectedElement.rotation}
              onChange={(e) => onUpdateElement(selectedElement.id, { rotation: Number(e.target.value) })}
            />
          </div>

          <div className="form-group">
            <label>X 坐标: {Math.round(selectedElement.x)}px</label>
            <input
              type="range"
              min="0"
              max="800"
              value={selectedElement.x}
              onChange={(e) => onUpdateElement(selectedElement.id, { x: Number(e.target.value) })}
            />
          </div>

          <div className="form-group">
            <label>Y 坐标: {Math.round(selectedElement.y)}px</label>
            <input
              type="range"
              min="0"
              max="540"
              value={selectedElement.y}
              onChange={(e) => onUpdateElement(selectedElement.id, { y: Number(e.target.value) })}
            />
          </div>

          <div className="form-group">
            <label>宽度: {Math.round(selectedElement.width)}px</label>
            <input
              type="range"
              min="20"
              max="800"
              value={selectedElement.width}
              onChange={(e) => onUpdateElement(selectedElement.id, { width: Number(e.target.value) })}
            />
          </div>

          <div className="form-group">
            <label>高度: {Math.round(selectedElement.height)}px</label>
            <input
              type="range"
              min="20"
              max="540"
              value={selectedElement.height}
              onChange={(e) => onUpdateElement(selectedElement.id, { height: Number(e.target.value) })}
            />
          </div>

          <button
            className="btn btn-danger btn-small"
            style={{ width: '100%', marginTop: '8px' }}
            onClick={() => { onDeleteElement(selectedElement.id); onCloseDrawer(); }}
          >
            🗑️ 删除此元素
          </button>
        </div>
      )}

      <div className="export-actions">
        <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={onExport}>
          📤 导出为 PNG
        </button>
      </div>
    </>
  );
}
