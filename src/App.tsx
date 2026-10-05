/**
 * 根组件：标题、3D 主场景、信息面板、辅助按钮与警告条。
 * 交互只向 store/状态机发送操作；警告文案统一来自状态机结论。
 */
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Scene from './components/Scene.tsx';
import InfoPanel from './components/InfoPanel.tsx';
import { useAssemblyStore } from './store.ts';

function ToolButton({
  color,
  label,
  tooltip,
  onClick,
}: {
  color: string;
  label: string;
  tooltip: string;
  onClick: () => void;
}) {
  return (
    <div className="tool-button-wrap">
      <button
        className="tool-button"
        style={{ background: color }}
        onClick={onClick}
        title={tooltip}
      >
        {label}
      </button>
    </div>
  );
}

export default function App() {
  const warning = useAssemblyStore((s) => s.warning);
  const reset = useAssemblyStore((s) => s.reset);
  const hintNext = useAssemblyStore((s) => s.hintNext);
  const assembleAll = useAssemblyStore((s) => s.assembleAll);
  const dismissWarning = useAssemblyStore((s) => s.dismissWarning);

  useEffect(() => {
    if (!warning) return;
    const timer = setTimeout(dismissWarning, 3000);
    return () => clearTimeout(timer);
  }, [warning, dismissWarning]);

  return (
    <div className="app">
      <h1 className="title">浑仪拆装研习</h1>
      <Scene />
      <InfoPanel />
      <div className="tools">
        <ToolButton color="#c0392b" label="重置" tooltip="所有部件归位到初始状态" onClick={reset} />
        <ToolButton color="#2980b9" label="提示" tooltip="高亮下一个可拆下的环体" onClick={hintNext} />
        <ToolButton
          color="#27ae60"
          label="逆向组装"
          tooltip="按正确顺序自动装回全部部件"
          onClick={assembleAll}
        />
      </div>
      <AnimatePresence>
        {warning && (
          <motion.div
            className="warning"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {warning}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
