import { useRepairStore } from '@/store/useRepairStore';
import RepairWorkshop from '@/components/RepairWorkshop';
import ToolPanel from '@/components/ToolPanel';
import ScrollViewer from '@/components/ScrollViewer';
import { tools } from '@/utils/tools';
import { getToolName } from '@/utils/tools';

export default function App() {
  const {
    regions,
    records,
    selectedTool,
    isDragging,
    dragPosition,
    showScrollViewer,
    completionRate,
    setShowScrollViewer,
    resetRepair,
  } = useRepairStore();

  const currentTool = tools.find((t) => t.type === selectedTool);
  const latestRecords = records.slice(-3).reverse();

  return (
    <div className="app-container">
      <div className="top-bar">
        <h1>青铜器修复模拟器</h1>
        <p className="subtitle">传承古法 · 修复国之重器</p>
      </div>

      <div className="canvas-container">
        <RepairWorkshop regions={regions} />
      </div>

      <div className="tool-panel">
        <ToolPanel />
      </div>

      <div className="scroll-panel">
        <div className="bg-[var(--color-paper-cream)] rounded-lg shadow-lg h-full p-4 overflow-hidden">
          <div className="text-center mb-4 border-b border-[var(--color-ink-black)] pb-2">
            <h3 className="font-[var(--font-brush)] text-lg text-[var(--color-ink-black)]">
              修复记录
            </h3>
          </div>
          <div className="h-[calc(100%-3rem)] overflow-y-auto">
            {latestRecords.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[var(--color-slate-gray)] font-[var(--font-brush)]">
                <div className="writing-mode-vertical text-center">
                  暂无修复记录
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {latestRecords.map((record) => (
                  <div
                    key={record.id}
                    className="border-l-2 border-[var(--color-rust-brown)] pl-3 py-1"
                  >
                    <div className="text-xs text-[var(--color-slate-gray)] mb-1">
                      {new Date(record.timestamp).toLocaleTimeString('zh-CN')}
                    </div>
                    <div
                      className="text-sm text-[var(--color-ink-black)] leading-relaxed"
                      style={{ fontFamily: 'var(--font-brush)' }}
                    >
                      {record.description}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bottom-bar">
        <div className="completion-badge">
          修复进度：{completionRate.toFixed(0)}%
        </div>
        <button
          className="scroll-btn"
          onClick={() => setShowScrollViewer(true)}
          disabled={records.length === 0}
        >
          展开卷轴
        </button>
        <button className="reset-btn" onClick={resetRepair}>
          重置
        </button>
      </div>

      {isDragging && currentTool && dragPosition && (
        <div
          className="drag-cursor"
          style={{
            left: dragPosition.x,
            top: dragPosition.y,
          }}
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
            style={{
              backgroundColor: currentTool.color,
              opacity: 0.9,
            }}
          >
            <span className="text-white text-xs font-bold">
              {getToolName(currentTool.type)}
            </span>
          </div>
        </div>
      )}

      {showScrollViewer && <ScrollViewer onClose={() => setShowScrollViewer(false)} />}
    </div>
  );
}
