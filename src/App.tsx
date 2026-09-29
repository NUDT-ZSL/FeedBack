import { useState, useEffect } from "react";
import ColorPalette from "./modules/color/colorPalette";
import PreviewPanel from "./modules/preview/previewPanel";
import HistoryPanel from "./modules/history/historyPanel";
import { useColorManager } from "./modules/color/colorManager";
import { formatCSSCode, copyToClipboard } from "./modules/export/cssExport";

export default function App() {
  const {
    colors,
    selectedIndex,
    setSelectedIndex,
    addColor,
    updateColor,
    removeColor,
    reorderColors,
    saveScheme,
    loadScheme,
    deleteScheme,
    schemes,
    transitioning,
  } = useColorManager();

  const [showCodeModal, setShowCodeModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const cssCode = formatCSSCode(colors);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  function handleSaveScheme() {
    const name = prompt("请输入方案名称:", `配色方案 ${schemes.length + 1}`);
    if (name !== null) {
      saveScheme(name);
      setToast("方案已保存");
    }
  }

  function handleExportCSS() {
    setShowCodeModal(true);
  }

  async function handleCopyCode() {
    const ok = await copyToClipboard(cssCode);
    if (ok) {
      setToast("已复制到剪贴板");
    } else {
      setToast("复制失败");
    }
  }

  function handleExportJSON() {
    const data = {
      name: `配色方案 ${schemes.length + 1}`,
      createdAt: new Date().toISOString(),
      colors,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `color-scheme-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToast("已导出 JSON 文件");
  }

  return (
    <div className="app-container">
      <HistoryPanel
        schemes={schemes}
        onLoadScheme={loadScheme}
        onDeleteScheme={deleteScheme}
      />

      <div className="main-content">
        <ColorPalette
          colors={colors}
          selectedIndex={selectedIndex}
          onSelectColor={setSelectedIndex}
          onUpdateColor={updateColor}
          onAddColor={addColor}
          onRemoveColor={removeColor}
          onReorderColors={reorderColors}
          onSaveScheme={handleSaveScheme}
          onExportCSS={handleExportCSS}
        />

        <PreviewPanel colors={colors} transitioning={transitioning} />
      </div>

      {showCodeModal && (
        <div
          className="code-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCodeModal(false);
          }}
        >
          <div className="code-modal">
            <div className="code-modal-header">
              <span className="code-modal-title">CSS 变量代码</span>
              <button
                className="code-modal-close"
                onClick={() => setShowCodeModal(false)}
                title="关闭"
              >
                ×
              </button>
            </div>
            <div className="code-modal-body">
              <pre className="code-block">{cssCode}</pre>
            </div>
            <div className="code-modal-actions">
              <button className="btn" onClick={handleExportJSON}>
                导出 JSON
              </button>
              <button className="btn btn-primary" onClick={handleCopyCode}>
                复制代码
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
