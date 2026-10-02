import { createArmillaryMachine } from './stateMachine.js';

// 浑仪部件与依赖：deps 表示“装回时必须先在位”的部件，拆下顺序相反。
const ARMILLARY_CONFIG = {
  parts: [
    { id: 'sight_tube', label: '窥管', deps: ['inner_ring'] },
    { id: 'inner_ring', label: '四游仪环', deps: ['middle_ring'] },
    { id: 'middle_ring', label: '三辰仪环', deps: ['outer_ring'] },
    { id: 'outer_ring', label: '六合仪环', deps: [] }
  ]
};

const machine = createArmillaryMachine(ARMILLARY_CONFIG);

const statusText = { ready: '可执行', done: '已完成', blocked: '受阻' };

function stepLine(title, step) {
  const reasons = step.reasons.length ? `<span class="reason">${step.reasons.join('；')}</span>` : '';
  return `<div class="step">${title}：<span class="status-${step.status}">${statusText[step.status]}</span>${reasons}</div>`;
}

function render() {
  const snapshot = machine.getSnapshot();

  document.getElementById('conclusion').textContent = snapshot.progress.conclusion;
  document.getElementById('progressFill').style.width = `${snapshot.progress.percent}%`;

  const hintEl = document.getElementById('hint');
  hintEl.textContent = snapshot.hint.message;
  hintEl.className = `hint ${snapshot.hint.kind}`;

  const diag = [];
  for (const ref of snapshot.diagnostics.missingRefs) {
    diag.push(`配置警告：部件 ${ref.part} 依赖的 ${ref.missing} 不存在`);
  }
  if (snapshot.diagnostics.cycleNodes.length) {
    diag.push(`配置警告：检测到依赖环（${snapshot.diagnostics.cycleNodes.join('、')}）`);
  }
  document.getElementById('diag').textContent = diag.join('；');

  const partsEl = document.getElementById('parts');
  partsEl.innerHTML = '';
  for (const part of snapshot.parts) {
    const card = document.createElement('div');
    card.className = 'part';
    const action = part.installed ? 'disassemble' : 'reassemble';
    const step = part.installed ? part.disassembleStep : part.reassembleStep;
    card.innerHTML = `
      <div class="part-head">
        <span class="part-name">${part.label}</span>
        <span class="badge ${part.installed ? 'installed' : 'removed'}">${part.installed ? '在位' : '已拆下'}</span>
      </div>
      ${stepLine('拆下步骤', part.disassembleStep)}
      ${stepLine('装回步骤', part.reassembleStep)}
    `;
    const button = document.createElement('button');
    button.textContent = part.installed ? '拆下' : '装回';
    button.disabled = step.status !== 'ready';
    button.addEventListener('click', () => {
      machine.applyOp({ op: action, part: part.id });
      render();
    });
    card.appendChild(button);
    partsEl.appendChild(card);
  }
}

render();
