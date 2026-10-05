/**
 * 信息面板：逐部件展示状态机推导出的步骤状态与受阻原因，以及整体进度结论。
 * 面板可拖动（react-draggable）。
 */
import Draggable from 'react-draggable';
import { useAssemblyStore } from '../store.ts';
import type { PartDerivation } from '../assembly/types.ts';

const STATUS_LIGHT: Record<string, string> = {
  installed: '#888',
  detached: '#e67e22',
};

const PHASE_LABEL: Record<string, string> = {
  assembled: '已组装',
  disassembling: '拆装中',
  disassembled: '已全部拆下',
};

function stepLabel(step: PartDerivation['step'], nameOf: (id: string) => string): string {
  switch (step.status) {
    case 'detachable':
      return '可拆下';
    case 'attachable':
      return '可装回';
    case 'blocked': {
      const reason = step.reason;
      if (reason.kind === 'unmet-dependencies') {
        return `受阻：先处理 ${reason.pending.map(nameOf).join('、')}`;
      }
      if (reason.kind === 'missing-dependency') {
        return `不可达：依赖缺失 ${reason.missing.join('、')}`;
      }
      return `不可达：依赖成环 ${reason.cycle.join('→')}`;
    }
  }
}

export default function InfoPanel() {
  const session = useAssemblyStore((s) => s.session);
  const { parts, conclusion } = session.derivation;
  const nameOf = (id: string) =>
    session.config.parts.find((p) => p.id === id)?.name ?? id;

  return (
    <Draggable handle=".panel-handle">
      <div className="info-panel">
        <div className="panel-handle">部件状态（拖动移动）</div>
        <ul>
          {session.config.parts.map((part) => {
            const derivation = parts[part.id];
            const statusKey = derivation.installed ? 'installed' : 'detached';
            return (
              <li key={part.id}>
                <span
                  className="light"
                  style={{ background: STATUS_LIGHT[statusKey] }}
                />
                <span className="part-name">{part.name}</span>
                <span className="part-status">
                  {derivation.installed ? '未拆' : '已拆'} · {stepLabel(derivation.step, nameOf)}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="progress">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${conclusion.percent}%` }}
            />
          </div>
          <div className="progress-text">
            {PHASE_LABEL[conclusion.phase]} · 已拆 {conclusion.detachedCount}/
            {conclusion.total}（{conclusion.percent}%）
          </div>
          {conclusion.unreachable.length > 0 && (
            <div className="unreachable">
              不可达部件：
              {conclusion.unreachable
                .map((u) => `${nameOf(u.part)}（${u.reason.kind}）`)
                .join('、')}
            </div>
          )}
        </div>
      </div>
    </Draggable>
  );
}
