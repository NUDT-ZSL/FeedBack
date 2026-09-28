import { useRef, useState, useCallback, useEffect } from 'react';
import ToolPanel from './ToolPanel';
import { CardElement, Template, ElementType } from '../types';
import { exportCardAsPNG, generateThumbnail } from '../utils/exportImage';

interface CardEditorProps {
  elements: CardElement[];
  selectedId: string | null;
  backgroundColor: string;
  currentTemplateId: string;
  templates: Template[];
  mobileDrawerOpen: boolean;
  onSelect: (id: string | null) => void;
  onAddElement: (type: ElementType) => void;
  onUpdateElement: (id: string, updates: Partial<CardElement>) => void;
  onDeleteElement: (id: string) => void;
  onApplyTemplate: (template: Template) => void;
  onSetBackground: (color: string) => void;
  onToggleDrawer: () => void;
  onCloseDrawer: () => void;
  onCardRef: (ref: HTMLDivElement | null) => void;
  onSaveHistory: () => void;
}

type DragState = null | {
  type: 'move' | 'resize' | 'rotate';
  id: string;
  startX: number;
  startY: number;
  startElX: number;
  startElY: number;
  startWidth: number;
  startHeight: number;
  startRotation: number;
  centerX?: number;
  centerY?: number;
};

export default function CardEditor(props: CardEditorProps) {
  const {
    elements, selectedId, backgroundColor, currentTemplateId, templates,
    mobileDrawerOpen, onSelect, onAddElement, onUpdateElement,
    onDeleteElement, onApplyTemplate, onSetBackground,
    onToggleDrawer, onCloseDrawer, onCardRef, onSaveHistory,
  } = props;

  const canvasRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<DragState>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showExportModal, setShowExportModal] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const selectedElement = elements.find(e => e.id === selectedId) || null;

  useEffect(() => {
    if (canvasRef.current) onCardRef(canvasRef.current);
  }, [onCardRef]);

  const toCanvasCoords = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent, el: CardElement, type: 'move' | 'resize' | 'rotate') => {
    e.stopPropagation();
    const coords = toCanvasCoords(e.clientX, e.clientY);

    if (type === 'rotate') {
      const rect = canvasRef.current?.getBoundingClientRect();
      const centerX = el.x + el.width / 2;
      const centerY = el.y + el.height / 2;
      const startAngle = Math.atan2(coords.y - centerY, coords.x - centerX);
      dragState.current = {
        type: 'rotate',
        id: el.id,
        startX: e.clientX,
        startY: e.clientY,
        startElX: el.x,
        startElY: el.y,
        startWidth: el.width,
        startHeight: el.height,
        startRotation: el.rotation,
        centerX,
        centerY,
      };
      (dragState.current as any).startAngle = startAngle;
    } else {
      dragState.current = {
        type,
        id: el.id,
        startX: coords.x,
        startY: coords.y,
        startElX: el.x,
        startElY: el.y,
        startWidth: el.width,
        startHeight: el.height,
        startRotation: el.rotation,
      };
    }

    onSelect(el.id);
  }, [onSelect, toCanvasCoords]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragState.current) return;
    const state = dragState.current;
    const coords = toCanvasCoords(e.clientX, e.clientY);

    if (state.type === 'move') {
      const dx = coords.x - state.startX;
      const dy = coords.y - state.startY;
      onUpdateElement(state.id, {
        x: state.startElX + dx,
        y: state.startElY + dy,
      });
    } else if (state.type === 'resize') {
      const dx = coords.x - state.startX;
      const dy = coords.y - state.startY;
      const rad = state.startRotation * Math.PI / 180;
      const cos = Math.cos(-rad);
      const sin = Math.sin(-rad);
      const localDx = dx * cos - dy * sin;
      const localDy = dx * sin + dy * cos;
      const newWidth = Math.max(20, state.startWidth + localDx);
      const newHeight = Math.max(20, state.startHeight + localDy);
      onUpdateElement(state.id, { width: newWidth, height: newHeight });
    } else if (state.type === 'rotate') {
      const angle = Math.atan2(coords.y - (state.centerY || 0), coords.x - (state.centerX || 0));
      const startAngle = (state as any).startAngle || 0;
      const delta = (angle - startAngle) * 180 / Math.PI;
      onUpdateElement(state.id, { rotation: state.startRotation + delta });
    }
  }, [onUpdateElement, toCanvasCoords]);

  const handleMouseUp = useCallback(() => {
    dragState.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const handleCanvasClick = useCallback(() => {
    onSelect(null);
    setEditingId(null);
  }, [onSelect]);

  const handleDoubleClick = useCallback((el: CardElement) => {
    if (el.type === 'text') {
      setEditingId(el.id);
      setEditValue(el.content || '');
    }
  }, []);

  const handleEditBlur = useCallback((el: CardElement) => {
    onUpdateElement(el.id, { content: editValue });
    setEditingId(null);
  }, [editValue, onUpdateElement]);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent, el: CardElement) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditBlur(el);
    }
  }, [handleEditBlur]);

  const openExportModal = useCallback(async () => {
    if (!canvasRef.current) return;
    try {
      setExporting(true);
      const thumb = await generateThumbnail(canvasRef.current);
      setPreviewUrl(thumb);
      setShowExportModal(true);
    } catch (e) {
      console.error(e);
    } finally {
      setExporting(false);
    }
  }, []);

  const confirmExport = useCallback(async () => {
    if (!canvasRef.current) return;
    try {
      setExporting(true);
      await exportCardAsPNG(canvasRef.current, `birthday-card-${Date.now()}.png`);
      onSaveHistory();
    } catch (e) {
      console.error(e);
    } finally {
      setExporting(false);
      setShowExportModal(false);
      setPreviewUrl(null);
    }
  }, [onSaveHistory]);

  const cancelExport = useCallback(() => {
    setShowExportModal(false);
    setPreviewUrl(null);
  }, []);

  const getElementStyle = (el: CardElement): React.CSSProperties => {
    const base: React.CSSProperties = {
      left: el.x,
      top: el.y,
      width: el.width,
      height: el.height,
      transform: `rotate(${el.rotation}deg)`,
      transition: dragState.current?.id === el.id ? 'none' : 'transform 0.3s ease, box-shadow 0.3s ease',
      fontFamily: el.type === 'text' ? el.fontFamily : undefined,
      fontSize: el.type === 'text' ? el.fontSize : el.fontSize,
      color: el.type === 'text' ? el.fontColor : undefined,
      fontWeight: el.type === 'text' ? 600 : undefined,
      lineHeight: el.type === 'text' ? 1.2 : 1,
    };
    if (el.type === 'text' && el.shadow) {
      base.textShadow = `${el.shadow.offsetX}px ${el.shadow.offsetY}px ${el.shadow.blur}px ${el.shadow.color}`;
    }
    return base;
  };

  const bgStyle: React.CSSProperties = backgroundColor.startsWith('linear-gradient')
    ? { background: backgroundColor }
    : { backgroundColor };

  return (
    <>
      <div className="editor-layout">
        <div className={`tool-panel scrollbar-thin ${mobileDrawerOpen ? 'mobile-open' : ''}`}>
          <ToolPanel
            templates={templates}
            currentTemplateId={currentTemplateId}
            selectedElement={selectedElement}
            backgroundColor={backgroundColor}
            onAddElement={onAddElement}
            onApplyTemplate={onApplyTemplate}
            onUpdateElement={onUpdateElement}
            onDeleteElement={onDeleteElement}
            onSetBackground={onSetBackground}
            onExport={openExportModal}
            onCloseDrawer={onCloseDrawer}
          />
        </div>

        <div className="editor-area" onClick={handleCanvasClick}>
          <div className="card-wrapper">
            <div
              ref={canvasRef}
              className="card-canvas"
              style={bgStyle}
              onClick={handleCanvasClick}
            >
              {elements.map(el => (
                <div
                  key={el.id}
                  className={`card-element ${selectedId === el.id ? 'selected' : ''} ${el.type === 'text' ? 'text-element' : 'decoration-element'}`}
                  style={getElementStyle(el)}
                  onMouseDown={(e) => handleMouseDown(e, el, 'move')}
                  onDoubleClick={() => handleDoubleClick(el)}
                  onClick={(e) => { e.stopPropagation(); onSelect(el.id); }}
                >
                  {el.type === 'text' ? (
                    editingId === el.id ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => handleEditBlur(el)}
                        onKeyDown={(e) => handleEditKeyDown(e, el)}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span>{el.content || ''}</span>
                    )
                  ) : (
                    <span style={{ fontSize: el.fontSize }}>{el.emoji}</span>
                  )}

                  {selectedId === el.id && !editingId && (
                    <>
                      {selectedId === el.id && el.type === 'text' && (
                        <>
                          <div className="rotate-line" />
                          <div
                            className="rotate-handle"
                            onMouseDown={(e) => handleMouseDown(e, el, 'rotate')}
                            onClick={(e) => e.stopPropagation()}
                          >
                            ↻
                          </div>
                        </>
                      )}
                      <div
                        className="resize-handle br"
                        onMouseDown={(e) => handleMouseDown(e, el, 'resize')}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <button className="mobile-drawer-toggle" onClick={onToggleDrawer}>
        🎨
      </button>
      <div
        className={`mobile-drawer-overlay ${mobileDrawerOpen ? 'active' : ''}`}
        onClick={onCloseDrawer}
      />

      {showExportModal && (
        <div className="modal-overlay" onClick={cancelExport}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>📤 导出贺卡</h3>
            <p style={{ color: '#7F8C8D', marginBottom: '8px' }}>
              请确认卡片效果，分辨率为 1920×1080
            </p>
            <div className="modal-preview">
              {previewUrl && <img src={previewUrl} alt="预览" />}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={cancelExport}>
                取消
              </button>
              <button className="btn" onClick={confirmExport} disabled={exporting}>
                {exporting ? '导出中...' : '✅ 确认导出 PNG'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
