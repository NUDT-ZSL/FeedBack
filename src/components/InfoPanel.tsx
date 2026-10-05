/**
 * 信息面板：七条部件状态列表 + 指示灯，可拖动。
 * 状态文本与灯色全部来自状态机快照，组件本身不做业务判断。
 */
import Draggable from 'react-draggable';
import { useAssemblyStore } from '../store.ts';
import { ARMILLARY_PARTS } from '../assembly/parts.ts';
import { STATUS_COLORS, toDisplayStatus } from '../types.ts';
import type { MountState } from '../assembly/types.ts';

export default function InfoPanel() {
  const snapshot = useAssemblyStore((s) => s.snapshot);

  return (
    <Draggable handle=".panel-handle" bounds="parent">
      <div
        style={{
          position: 'absolute',
          top: 70,
          right: 16,
          width: 200,
          background: '#3a2416cc',
          borderRadius: 12,
          padding: 12,
          color: '#f5e9d3',
          fontSize: 13,
          zIndex: 10,
          backdropFilter: 'blur(2px)',
          border: '1px solid #5d4037',
        }}
      >
        <div
          className="panel-handle"
          style={{ cursor: 'move', fontWeight: 700, marginBottom: 8, textAlign: 'center' }}
        >
          拆装进度 {snapshot.progress.disassembled}/{snapshot.progress.total}
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {ARMILLARY_PARTS.map((part) => {
            const state: MountState = snapshot.mountStates[part.id] ?? 'installed';
            return (
              <li
                key={part.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: STATUS_COLORS[state],
                    display: 'inline-block',
                    boxShadow: state === 'assembled' ? '0 0 6px #ffd700' : 'none',
                  }}
                />
                <span style={{ flex: 1 }}>{part.name}</span>
                <span style={{ fontSize: 12, opacity: 0.85 }}>{toDisplayStatus(state)}</span>
              </li>
            );
          })}
        </ul>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.9 }}>{snapshot.progress.message}</div>
      </div>
    </Draggable>
  );
}
