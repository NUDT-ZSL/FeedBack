import { useState, useCallback } from 'react';
import ColorPalette from './components/ColorPalette';
import WorkArea from './components/WorkArea';
import PreviewPanel from './components/PreviewPanel';
import ColorPicker from './components/ColorPicker';
import ImportModal from './components/ImportModal';
import BindingMenu from './components/BindingMenu';
import { usePaletteStore, type Swatch, type SemanticTag, type ComponentBindingKey } from './store';

interface MenuState {
  x: number;
  y: number;
  componentKey: ComponentBindingKey;
}

const App = () => {
  const {
    swatches,
    toast,
    updateSwatch,
    exportPalette,
    importPalette,
    showToast
  } = usePaletteStore();

  const [editingSwatch, setEditingSwatch] = useState<Swatch | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [bindingMenu, setBindingMenu] = useState<MenuState | null>(null);

  const handlePaletteDragStart = useCallback((_tag: SemanticTag, _color: string) => {
    // can add visual feedback here
  }, []);

  const handleSwatchDoubleClick = useCallback((swatch: Swatch) => {
    setEditingSwatch(swatch);
  }, []);

  const handleColorPickerConfirm = useCallback((id: string, color: string) => {
    updateSwatch(id, color);
    setEditingSwatch(null);
  }, [updateSwatch]);

  const handleExport = useCallback(async () => {
    if (swatches.length === 0) {
      showToast('请先添加至少一个色块');
      return;
    }
    const json = exportPalette();
    try {
      await navigator.clipboard.writeText(json);
      showToast('色板JSON已复制到剪贴板');
    } catch {
      showToast('复制失败，请手动复制');
      console.log(json);
    }
  }, [swatches.length, exportPalette, showToast]);

  const handleImportConfirm = useCallback((json: string) => {
    if (!json.trim()) {
      showToast('请输入JSON数据');
      return;
    }
    importPalette(json);
    setShowImport(false);
  }, [importPalette, showToast]);

  const handleComponentContextMenu = useCallback((e: React.MouseEvent, bindingKey: ComponentBindingKey) => {
    e.preventDefault();
    setBindingMenu({
      x: e.clientX,
      y: e.clientY,
      componentKey: bindingKey
    });
  }, []);

  return (
    <div className="app-container" onContextMenu={(e) => {
      if (bindingMenu) {
        e.preventDefault();
      }
    }}>
      <div className="app-main">
        <ColorPalette onDragStart={handlePaletteDragStart} />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div className="work-area-header">
            <button className="action-btn" onClick={() => setShowImport(true)}>
              导入色板
            </button>
            <button className="action-btn" onClick={handleExport}>
              导出色板
            </button>
          </div>
          <WorkArea onSwatchDoubleClick={handleSwatchDoubleClick} />
        </div>
      </div>
      <PreviewPanel onComponentContextMenu={handleComponentContextMenu} />

      {editingSwatch && (
        <ColorPicker
          swatch={editingSwatch}
          onConfirm={handleColorPickerConfirm}
          onClose={() => setEditingSwatch(null)}
        />
      )}

      {showImport && (
        <ImportModal
          onConfirm={handleImportConfirm}
          onClose={() => setShowImport(false)}
        />
      )}

      {bindingMenu && (
        <BindingMenu
          x={bindingMenu.x}
          y={bindingMenu.y}
          componentKey={bindingMenu.componentKey}
          onClose={() => setBindingMenu(null)}
        />
      )}

      {toast && (
        <div className="toast">{toast.message}</div>
      )}
    </div>
  );
};

export default App;
