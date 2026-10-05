/** 根组件：场景 + 信息面板 + 辅助按钮 + 顶部警告。 */
import { motion } from 'framer-motion';
import Scene from './components/Scene.tsx';
import InfoPanel from './components/InfoPanel.tsx';
import { useAssemblyStore } from './store.ts';

function ToolButton({
  label,
  color,
  title,
  onClick,
}: {
  label: string;
  color: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.1 }}
      title={title}
      onClick={onClick}
      style={{
        width: 64,
        height: 64,
        borderRadius: '50%',
        border: '2px solid #5d4037',
        color: '#ffffff',
        fontSize: 15,
        fontWeight: 700,
        cursor: 'pointer',
        background: color,
        boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
      }}
    >
      {label}
    </motion.button>
  );
}

export default function App() {
  const warning = useAssemblyStore((s) => s.warning);
  const reset = useAssemblyStore((s) => s.reset);
  const hint = useAssemblyStore((s) => s.hint);
  const assembleAll = useAssemblyStore((s) => s.assembleAll);
  const assembling = useAssemblyStore((s) => s.assembling);
  const snapshot = useAssemblyStore((s) => s.snapshot);
  const phase = snapshot.progress.phase;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 0,
          right: 0,
          textAlign: 'center',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            fontSize: 32,
            color: '#3e2723',
            fontWeight: 700,
            fontFamily: '"Noto Serif SC", serif',
          }}
        >
          浑仪拆装研习
        </span>
      </div>
      {warning && (
        <div
          style={{
            position: 'absolute',
            top: 60,
            left: 0,
            right: 0,
            textAlign: 'center',
            color: '#e67e22',
            fontSize: 20,
            fontWeight: 700,
            zIndex: 6,
            pointerEvents: 'none',
          }}
        >
          顺序偏差！{warning}
        </div>
      )}
      <Scene />
      <InfoPanel />
      <div style={{ position: 'absolute', left: 20, bottom: 20, display: 'flex', gap: 14, zIndex: 10 }}>
        <ToolButton label="重置" color="#c0392b" title="所有部件归位到浑仪初始状态" onClick={reset} />
        <ToolButton label="提示" color="#2980b9" title="高亮下一个待拆部件" onClick={hint} />
      </div>
      <div style={{ position: 'absolute', right: 20, bottom: 20, zIndex: 10 }}>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          disabled={phase !== 'assembly' || assembling}
          onClick={assembleAll}
          style={{
            width: 96,
            height: 60,
            borderRadius: 30,
            border: '2px solid #5d4037',
            background: phase === 'assembly' && !assembling ? '#27ae60' : '#95a5a6',
            color: '#ffffff',
            fontSize: 15,
            fontWeight: 700,
            cursor: phase === 'assembly' && !assembling ? 'pointer' : 'not-allowed',
          }}
        >
          {assembling ? '组装中…' : '逆向组装'}
        </motion.button>
      </div>
    </div>
  );
}
