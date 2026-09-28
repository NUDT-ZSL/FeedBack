import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAppStore, getCurrentPage } from '../store';
import type { ComponentType, UIComponent } from '../types';
import { PRESET_ICONS } from '../types';
import { bezierPath, snapPosition, snapToGrid, clamp } from '../utils';

interface DragState {
  type: 'move' | 'resize' | null;
  componentId: string | null;
  startX: number;
  startY: number;
  originalPosition?: { x: number; y: number };
  originalSize?: { width: number; height: number };
}

interface SettingsModalState {
  open: boolean;
  component: UIComponent | null;
  text: string;
  backgroundColor: string;
  icon: string | undefined;
  targetPageId: string | undefined;
}

interface CanvasComponentProps {
  component: UIComponent;
  isSelected: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onResizeMouseDown: (e: React.MouseEvent) => void;
  onConnectorMouseDown: (e: React.MouseEvent) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSettings: () => void;
  justPlacedId: string | null;
}

const CanvasComponentView: React.FC<CanvasComponentProps> = ({
  component,
  isSelected,
  onMouseDown,
  onResizeMouseDown,
  onConnectorMouseDown,
  onDelete,
  onDuplicate,
  onSettings,
  justPlacedId,
}) => {
  const { position, size, type, text, backgroundColor, icon } = component;

  const style: React.CSSProperties = {
    left: position.x,
    top: position.y,
    width: size.width,
    height: size.height,
    background: backgroundColor,
  };

  const placedClass = justPlacedId === component.id ? 'placed' : '';
  const selectedClass = isSelected ? 'selected' : '';

  const renderInnerContent = () => {
    switch (type) {
      case 'button':
        return <div style={{ fontWeight: 500 }}>{text}</div>;
      case 'input':
        return (
          <div
            style={{
              width: '100%',
              textAlign: 'left',
              color: 'var(--text-light)',
              paddingLeft: 4,
            }}
          >
            {text}
          </div>
        );
      case 'navbar':
        return (
          <div
            style={{
              display: 'flex',
              gap: 24,
              width: '100%',
              paddingLeft: 20,
              color: 'white',
              background: 'transparent',
            }}
          >
            {text.split(/\s{2,}/).map((item, i) => (
              <span key={i} style={{ opacity: i === 0 ? 1 : 0.8 }}>
                {item}
              </span>
            ))}
          </div>
        );
      case 'list':
        return (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {text.split('\n').map((line, i, arr) => (
              <div
                key={i}
                style={{
                  fontSize: 13,
                  padding: '4px 0',
                  borderBottom: i < arr.length - 1 ? '1px solid var(--grid)' : 'none',
                }}
              >
                • {line}
              </div>
            ))}
          </div>
        );
      case 'image':
        return <div style={{ fontSize: 36 }}>{icon || '🖼️'}</div>;
      case 'text':
        return (
          <div style={{ width: '100%', textAlign: 'left', paddingLeft: 4 }}>{text}</div>
        );
      case 'card': {
        const lines = text.split('\n');
        return (
          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 6,
              boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14 }}>{lines[0] || ''}</div>
            <div style={{ fontSize: 12, color: 'var(--text-light)' }}>
              {lines.slice(1).join(' ')}
            </div>
          </div>
        );
      }
      case 'checkbox':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', paddingLeft: 12 }}>
            <div
              style={{
                width: 16,
                height: 16,
                border: '2px solid var(--border)',
                borderRadius: 4,
                flexShrink: 0,
              }}
            />
            <span>{text}</span>
          </div>
        );
      case 'dropdown':
        return (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              padding: '0 12px',
            }}
          >
            <span>{text.replace('▼', '').trim()}</span>
            <span style={{ fontSize: 16 }}>▼</span>
          </div>
        );
      default:
        return <div>{text}</div>;
    }
  };

  return (
    <div
      className={`canvas-component canvas-component-${type} ${selectedClass} ${placedClass}`}
      style={style}
      onMouseDown={onMouseDown}
    >
      {renderInnerContent()}

      {isSelected && (
        <>
          <div className="comp-actions">
            <button
              className="comp-action-btn"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSettings();
              }}
              title="设置"
            >
              ⚙️
            </button>
            <button
              className="comp-action-btn"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
              title="复制"
            >
              📋
            </button>
            <button
              className="comp-action-btn"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="删除"
            >
              🗑️
            </button>
          </div>
          <div className="resize-handle" onMouseDown={onResizeMouseDown} />
        </>
      )}

      <div className="connector-dot" onMouseDown={onConnectorMouseDown} />
    </div>
  );
};

const Canvas: React.FC = () => {
  const {
    pages,
    currentPageId,
    selectedComponentId,
    selectedConnectionId,
    draggingFromConnector,
    tempConnectorEnd,
    selectComponent,
    selectConnection,
    addComponent,
    updateComponent,
    deleteComponent,
    duplicateComponent,
    addConnection,
    deleteConnection,
    setDraggingFromConnector,
    setTempConnectorEnd,
    saveHistory,
  } = useAppStore();

  const currentPage = pages.find((p) => p.id === currentPageId) || pages[0];
  const canvasRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState>({
    type: null,
    componentId: null,
    startX: 0,
    startY: 0,
  });
  const [justPlacedId, setJustPlacedId] = useState<string | null>(null);
  const [historySaved, setHistorySaved] = useState(false);

  const [settingsModal, setSettingsModal] = useState<SettingsModalState>({
    open: false,
    component: null,
    text: '',
    backgroundColor: '#ffffff',
    icon: undefined,
    targetPageId: undefined,
  });

  const getCanvasCoords = useCallback((e: MouseEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left + canvas.scrollLeft,
      y: e.clientY - rect.top + canvas.scrollTop,
    };
  }, []);

  const handleComponentMouseDown = useCallback(
    (comp: UIComponent, e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      selectComponent(comp.id);
      const coords = getCanvasCoords(e);
      setDragState({
        type: 'move',
        componentId: comp.id,
        startX: coords.x,
        startY: coords.y,
        originalPosition: { ...comp.position },
      });
      setHistorySaved(false);
    },
    [selectComponent, getCanvasCoords]
  );

  const handleResizeMouseDown = useCallback(
    (comp: UIComponent, e: React.MouseEvent) => {
      e.stopPropagation();
      const coords = getCanvasCoords(e);
      setDragState({
        type: 'resize',
        componentId: comp.id,
        startX: coords.x,
        startY: coords.y,
        originalPosition: { ...comp.position },
        originalSize: { ...comp.size },
      });
      setHistorySaved(false);
    },
    [getCanvasCoords]
  );

  const handleConnectorMouseDown = useCallback(
    (comp: UIComponent, e: React.MouseEvent) => {
      e.stopPropagation();
      selectComponent(comp.id);
      const x = comp.position.x + comp.size.width / 2;
      const y = comp.position.y + comp.size.height + 6;
      setDraggingFromConnector({ componentId: comp.id, x, y });
      setTempConnectorEnd({ x, y });
    },
    [selectComponent, setDraggingFromConnector, setTempConnectorEnd]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const coords = getCanvasCoords(e);

      if (dragState.type === 'move' && dragState.componentId) {
        if (!historySaved) {
          saveHistory();
          setHistorySaved(true);
        }
        const dx = coords.x - dragState.startX;
        const dy = coords.y - dragState.startY;
        const newPos = snapPosition({
          x: (dragState.originalPosition!.x + dx),
          y: (dragState.originalPosition!.y + dy),
        });
        updateComponent(dragState.componentId, {
          position: { x: Math.max(0, newPos.x), y: Math.max(0, newPos.y) },
        });
        return;
      }

      if (dragState.type === 'resize' && dragState.componentId) {
        if (!historySaved) {
          saveHistory();
          setHistorySaved(true);
        }
        const dx = coords.x - dragState.startX;
        const dy = coords.y - dragState.startY;
        const newWidth = clamp(snapToGrid(dragState.originalSize!.width + dx), 40, 800);
        const newHeight = clamp(snapToGrid(dragState.originalSize!.height + dy), 30, 600);
        updateComponent(dragState.componentId, {
          size: { width: newWidth, height: newHeight },
        });
        return;
      }

      if (draggingFromConnector) {
        setTempConnectorEnd({ x: coords.x, y: coords.y });
      }
    },
    [
      dragState,
      draggingFromConnector,
      historySaved,
      getCanvasCoords,
      saveHistory,
      updateComponent,
      setTempConnectorEnd,
    ]
  );

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      setDragState({ type: null, componentId: null, startX: 0, startY: 0 });

      if (draggingFromConnector && tempConnectorEnd) {
        // Check if mouse is over a connector
        const coords = getCanvasCoords(e);
        const targetComp = currentPage.components.find((comp) => {
          const cx = comp.position.x + comp.size.width / 2;
          const cy = comp.position.y + comp.size.height + 6;
          const dx = coords.x - cx;
          const dy = coords.y - cy;
          return Math.sqrt(dx * dx + dy * dy) < 20;
        });

        if (targetComp && targetComp.id !== draggingFromConnector.componentId) {
          addConnection(draggingFromConnector.componentId, targetComp.id);
        }

        setDraggingFromConnector(null);
        setTempConnectorEnd(null);
      }
    },
    [
      draggingFromConnector,
      tempConnectorEnd,
      currentPage.components,
      getCanvasCoords,
      addConnection,
      setDraggingFromConnector,
      setTempConnectorEnd,
    ]
  );

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      selectComponent(null);
      selectConnection(null);
    }
  };

  const handleCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('componentType') as ComponentType;
      if (!type) return;
      const coords = getCanvasCoords(e);
      addComponent(type, coords);
      setTimeout(() => {
        const page = getCurrentPage(useAppStore.getState());
        const last = page.components[page.components.length - 1];
        if (last) {
          setJustPlacedId(last.id);
          setTimeout(() => setJustPlacedId(null), 250);
        }
      }, 10);
    },
    [addComponent, getCanvasCoords]
  );

  const handleCanvasDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const openSettings = (comp: UIComponent) => {
    setSettingsModal({
      open: true,
      component: comp,
      text: comp.text,
      backgroundColor: comp.backgroundColor,
      icon: comp.icon,
      targetPageId: comp.targetPageId,
    });
  };

  const saveSettings = () => {
    if (!settingsModal.component) return;
    saveHistory();
    updateComponent(settingsModal.component.id, {
      text: settingsModal.text,
      backgroundColor: settingsModal.backgroundColor,
      icon: settingsModal.icon,
      targetPageId: settingsModal.targetPageId,
    });
    setSettingsModal((s) => ({ ...s, open: false }));
  };

  const handleConnectionDelete = (e: React.MouseEvent) => {
    if (e.key === 'Delete' || (e as unknown as KeyboardEvent).key === 'Backspace') {
      // handled in keydown
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (settingsModal.open) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedConnectionId) {
        e.preventDefault();
        deleteConnection(selectedConnectionId);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedComponentId) {
        e.preventDefault();
        deleteComponent(selectedComponentId);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedComponentId, selectedConnectionId, settingsModal.open, deleteComponent, deleteConnection]);

  // Render connections
  const renderConnections = () => {
    const items: React.ReactNode[] = [];
    currentPage.connections.forEach((conn) => {
      const fromComp = currentPage.components.find((c) => c.id === conn.fromComponentId);
      const toComp = currentPage.components.find((c) => c.id === conn.toComponentId);
      if (!fromComp || !toComp) return;

      const x1 = fromComp.position.x + fromComp.size.width / 2;
      const y1 = fromComp.position.y + fromComp.size.height + 6;
      const x2 = toComp.position.x + toComp.size.width / 2;
      const y2 = toComp.position.y + 6;

      const isSelected = selectedConnectionId === conn.id;
      items.push(
        <path
          key={conn.id}
          d={bezierPath(x1, y1, x2, y2)}
          className={`connection-path ${isSelected ? 'selected' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            selectConnection(conn.id);
          }}
          onMouseDown={(e) => e.stopPropagation()}
        />
      );

      // Arrow
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const arrowLen = 10;
      const ax1 = x2 - arrowLen * Math.cos(ang - Math.PI / 6);
      const ay1 = y2 - arrowLen * Math.sin(ang - Math.PI / 6);
      const ax2 = x2 - arrowLen * Math.cos(ang + Math.PI / 6);
      const ay2 = y2 - arrowLen * Math.sin(ang + Math.PI / 6);
      items.push(
        <polygon
          key={`${conn.id}-arrow`}
          points={`${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}`}
          fill={isSelected ? '#1976d2' : '#616161'}
          style={{ pointerEvents: 'none' }}
        />
      );
    });

    // Temp connection line
    if (draggingFromConnector && tempConnectorEnd) {
      items.push(
        <path
          key="temp"
          d={bezierPath(
            draggingFromConnector.x,
            draggingFromConnector.y,
            tempConnectorEnd.x,
            tempConnectorEnd.y
          )}
          className="temp-connection"
        />
      );
    }

    return items;
  };

  // Quick click-add mode
  const handleToolbarClickAdd = useCallback(() => {
    // This is triggered via window event
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const type = e.detail as ComponentType;
      // Add at default position (centered in viewport)
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const x = (rect.width / 2 - 100 + canvas.scrollLeft);
        const y = (rect.height / 2 - 40 + canvas.scrollTop);
        addComponent(type, { x, y });
        setTimeout(() => {
          const page = getCurrentPage(useAppStore.getState());
          const last = page.components[page.components.length - 1];
          if (last) {
            setJustPlacedId(last.id);
            setTimeout(() => setJustPlacedId(null), 250);
          }
        }, 10);
      }
    };
    window.addEventListener('tool:add-component', handler as EventListener);
    return () => window.removeEventListener('tool:add-component', handler as EventListener);
  }, [addComponent]);

  return (
    <div className="canvas-wrapper" ref={canvasRef}>
      <div
        className="canvas"
        onClick={handleCanvasClick}
        onDrop={handleCanvasDrop}
        onDragOver={handleCanvasDragOver}
        style={{ minWidth: '2000px', minHeight: '1500px' }}
      >
        <svg className="connections-svg" style={{ minWidth: '2000px', minHeight: '1500px' }}>
          {renderConnections()}
        </svg>

        {currentPage.components.map((comp) => (
          <CanvasComponentView
            key={comp.id}
            component={comp}
            isSelected={selectedComponentId === comp.id}
            justPlacedId={justPlacedId}
            onMouseDown={(e) => handleComponentMouseDown(comp, e)}
            onResizeMouseDown={(e) => handleResizeMouseDown(comp, e)}
            onConnectorMouseDown={(e) => handleConnectorMouseDown(comp, e)}
            onDelete={() => deleteComponent(comp.id)}
            onDuplicate={() => duplicateComponent(comp.id)}
            onSettings={() => openSettings(comp)}
          />
        ))}
      </div>

      {/* Settings Modal */}
      {settingsModal.open && settingsModal.component && (
        <div
          className="modal-overlay"
          onClick={() => setSettingsModal((s) => ({ ...s, open: false }))}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">组件设置</div>

            <div className="modal-field">
              <label className="modal-label">显示文字</label>
              <textarea
                className="modal-textarea"
                value={settingsModal.text}
                onChange={(e) =>
                  setSettingsModal((s) => ({ ...s, text: e.target.value }))
                }
              />
            </div>

            <div className="modal-field">
              <label className="modal-label">背景颜色</label>
              <input
                type="color"
                className="color-picker-input"
                value={settingsModal.backgroundColor}
                onChange={(e) =>
                  setSettingsModal((s) => ({ ...s, backgroundColor: e.target.value }))
                }
              />
            </div>

            {settingsModal.component.type === 'image' && (
              <div className="modal-field">
                <label className="modal-label">图标</label>
                <div className="icon-picker">
                  {PRESET_ICONS.map((ic) => (
                    <div
                      key={ic}
                      className={`icon-option ${settingsModal.icon === ic ? 'selected' : ''}`}
                      onClick={() => setSettingsModal((s) => ({ ...s, icon: ic }))}
                    >
                      {ic}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="modal-field">
              <label className="modal-label">跳转页面（跨页面链接）</label>
              <select
                className="modal-select"
                value={settingsModal.targetPageId || ''}
                onChange={(e) =>
                  setSettingsModal((s) => ({
                    ...s,
                    targetPageId: e.target.value || undefined,
                  }))
                }
              >
                <option value="">（无，使用画布连线）</option>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.id === currentPageId ? '（当前页）' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="modal-actions">
              <button
                className="btn-secondary"
                onClick={() => setSettingsModal((s) => ({ ...s, open: false }))}
              >
                取消
              </button>
              <button className="btn-primary" onClick={saveSettings}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Canvas;
