import { useState, useEffect } from "react";
import type { ColorScheme } from "../color/colorManager";

interface HistoryPanelProps {
  schemes: ColorScheme[];
  onLoadScheme: (scheme: ColorScheme) => void;
  onDeleteScheme: (id: string) => void;
}

export default function HistoryPanel({
  schemes,
  onLoadScheme,
  onDeleteScheme,
}: HistoryPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth <= 1024);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  function formatDate(ts: number) {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d
      .getHours()
      .toString()
      .padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }

  const renderList = () => (
    <div className="history-list">
      {schemes.length === 0 ? (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            color: "#adb5bd",
            fontSize: 13,
          }}
        >
          暂无保存的方案
          <br />
          点击"保存方案"添加
        </div>
      ) : (
        schemes.map((scheme) => (
          <div
            key={scheme.id}
            className="history-item"
            onClick={() => onLoadScheme(scheme)}
            title={`${scheme.name} · ${formatDate(scheme.createdAt)}`}
          >
            <div className="history-item-swatches">
              {scheme.colors.slice(0, 4).map((c, i) => (
                <div
                  key={i}
                  className="history-swatch"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <span className="history-item-name">{scheme.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`删除方案 "${scheme.name}"?`)) {
                  onDeleteScheme(scheme.id);
                }
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "#adb5bd",
                cursor: "pointer",
                fontSize: 16,
                padding: 4,
                opacity: 0,
                transition: "opacity 0.2s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "0")}
              title="删除"
            >
              ×
            </button>
          </div>
        ))
      )}
    </div>
  );

  if (isMobile) {
    return (
      <div className={`mobile-drawer ${drawerOpen ? "open" : ""}`}>
        <div
          className="mobile-drawer-handle"
          onClick={() => setDrawerOpen(!drawerOpen)}
        >
          {drawerOpen ? "收起历史记录" : "历史记录"}
        </div>
        <div className="mobile-drawer-content">{renderList()}</div>
      </div>
    );
  }

  return (
    <div className={`history-panel ${expanded ? "expanded" : "collapsed"}`}>
      <button
        className="history-toggle"
        onClick={() => setExpanded(!expanded)}
        title={expanded ? "收起历史记录" : "展开历史记录"}
      >
        {expanded ? "«" : "»"}
      </button>
      {expanded && (
        <>
          <div className="history-header">
            <span>历史方案</span>
            <span style={{ fontSize: 11, color: "#adb5bd" }}>{schemes.length}</span>
          </div>
          {renderList()}
        </>
      )}
    </div>
  );
}
