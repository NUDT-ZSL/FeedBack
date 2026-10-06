import { ElementType, ELEMENT_CONFIGS } from './elements';
import {
  RuleSet,
  ELEMENT_ORDER,
  MAX_FUSION_THRESHOLD,
  MIN_FUSION_THRESHOLD,
  cloneRules,
  elementLabel,
  newPairId,
  pairLabel,
  validateRuleSet
} from './rules';
import {
  Counts,
  DeductionResult,
  enumerateCandidates,
  planTarget,
  resolveNextReaction
} from './deduction';
import { SnapshotStore, diffRuleSets } from './snapshots';

export interface PanelDeps {
  getRules(): RuleSet;
  applyRules(rules: RuleSet): void;
  getCounts(): Counts;
}

const ELEMENT_TYPES = ELEMENT_ORDER;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function elementSelect(value: ElementType, onChange: (t: ElementType) => void): HTMLSelectElement {
  const select = el('select', 'rule-select');
  for (const type of ELEMENT_TYPES) {
    const option = el('option', undefined, ELEMENT_CONFIGS[type].nameCN);
    option.value = type;
    select.appendChild(option);
  }
  select.value = value;
  select.addEventListener('change', () => onChange(select.value as ElementType));
  return select;
}

export class RulePanel {
  private deps: PanelDeps;
  private store: SnapshotStore;
  private root: HTMLDivElement;
  private toggleBtn: HTMLButtonElement;

  private thresholdInput!: HTMLInputElement;
  private pairListEl!: HTMLDivElement;
  private issuesEl!: HTMLDivElement;
  private predictionEl!: HTMLDivElement;
  private compositionEl!: HTMLDivElement;
  private targetSelect!: HTMLSelectElement;
  private deductionEl!: HTMLDivElement;
  private snapshotListEl!: HTMLDivElement;
  private snapshotNameInput!: HTMLInputElement;
  private compareA!: HTMLSelectElement;
  private compareB!: HTMLSelectElement;
  private diffEl!: HTMLDivElement;
  private statusEl!: HTMLDivElement;

  constructor(deps: PanelDeps, store: SnapshotStore) {
    this.deps = deps;
    this.store = store;

    this.toggleBtn = el('button', 'panel-toggle', '⚗ 规则配置');
    document.body.appendChild(this.toggleBtn);

    this.root = el('div', 'rule-panel');
    document.body.appendChild(this.root);

    this.toggleBtn.addEventListener('click', () => {
      this.root.classList.toggle('open');
      this.toggleBtn.classList.toggle('shifted');
    });

    this.build();
    this.store.onChange(() => this.refreshSnapshots());
    this.refresh();
  }

  private applyAndRefresh(): void {
    this.deps.applyRules(this.deps.getRules());
    this.refresh();
  }

  private build(): void {
    this.root.appendChild(el('h2', 'panel-title', '规则集配置'));

    this.statusEl = el('div', 'panel-status');
    this.root.appendChild(this.statusEl);

    this.root.appendChild(this.buildFusionSection());
    this.root.appendChild(this.buildPairsSection());

    this.issuesEl = el('div', 'panel-issues');
    this.root.appendChild(this.issuesEl);

    this.root.appendChild(this.buildDeductionSection());
    this.root.appendChild(this.buildSnapshotSection());
  }

  private buildFusionSection(): HTMLElement {
    const section = el('section', 'panel-section');
    section.appendChild(el('h3', undefined, '融合规则'));
    const row = el('div', 'field-row');
    row.appendChild(el('label', undefined, `同元素融合阈值（${MIN_FUSION_THRESHOLD}–${MAX_FUSION_THRESHOLD}）`));
    this.thresholdInput = el('input', 'rule-input');
    this.thresholdInput.type = 'number';
    this.thresholdInput.min = String(MIN_FUSION_THRESHOLD);
    this.thresholdInput.max = String(MAX_FUSION_THRESHOLD);
    this.thresholdInput.addEventListener('input', () => {
      const rules = this.deps.getRules();
      rules.fusionThreshold = Number(this.thresholdInput.value);
      this.applyAndRefresh();
    });
    row.appendChild(this.thresholdInput);
    section.appendChild(row);
    return section;
  }

  private buildPairsSection(): HTMLElement {
    const section = el('section', 'panel-section');
    const header = el('div', 'section-header');
    header.appendChild(el('h3', undefined, '冲突对'));
    const addBtn = el('button', 'btn-small', '＋ 添加冲突对');
    addBtn.addEventListener('click', () => {
      const rules = this.deps.getRules();
      rules.conflictPairs.push({
        id: newPairId(),
        a: 'fire',
        b: 'water',
        reaction: '新的反应……',
        color: '#ffcc66'
      });
      this.applyAndRefresh();
      this.rebuildPairRows();
    });
    header.appendChild(addBtn);
    section.appendChild(header);

    this.pairListEl = el('div', 'pair-list');
    section.appendChild(this.pairListEl);
    return section;
  }

  private rebuildPairRows(): void {
    const rules = this.deps.getRules();
    this.pairListEl.innerHTML = '';

    if (rules.conflictPairs.length === 0) {
      this.pairListEl.appendChild(
        el('div', 'empty-hint', '暂无冲突对。点击「添加冲突对」创建，或仅依靠融合规则。')
      );
      return;
    }

    rules.conflictPairs.forEach((pair, index) => {
      const row = el('div', 'pair-row');

      const head = el('div', 'pair-row-head');
      head.appendChild(el('span', 'pair-index', `#${index + 1}`));
      head.appendChild(elementSelect(pair.a, t => { pair.a = t; this.applyAndRefresh(); }));
      head.appendChild(el('span', undefined, '×'));
      head.appendChild(elementSelect(pair.b, t => { pair.b = t; this.applyAndRefresh(); }));

      const colorInput = el('input', 'color-input');
      colorInput.type = 'color';
      colorInput.value = pair.color;
      colorInput.title = '反应颜色';
      colorInput.addEventListener('input', () => { pair.color = colorInput.value; this.applyAndRefresh(); });
      head.appendChild(colorInput);

      const delBtn = el('button', 'btn-danger', '删除');
      delBtn.addEventListener('click', () => {
        rules.conflictPairs.splice(index, 1);
        this.applyAndRefresh();
        this.rebuildPairRows();
      });
      head.appendChild(delBtn);
      row.appendChild(head);

      const textInput = el('input', 'rule-input wide');
      textInput.type = 'text';
      textInput.value = pair.reaction;
      textInput.placeholder = '反应文案';
      textInput.addEventListener('input', () => { pair.reaction = textInput.value; this.applyAndRefresh(); });
      row.appendChild(textInput);

      this.pairListEl.appendChild(row);
    });
  }

  private buildDeductionSection(): HTMLElement {
    const section = el('section', 'panel-section');
    section.appendChild(el('h3', undefined, '反应推演'));

    this.compositionEl = el('div', 'composition');
    section.appendChild(this.compositionEl);

    this.predictionEl = el('div', 'prediction');
    section.appendChild(this.predictionEl);

    const row = el('div', 'field-row');
    row.appendChild(el('label', undefined, '目标反应'));
    this.targetSelect = el('select', 'rule-select wide');
    row.appendChild(this.targetSelect);
    const runBtn = el('button', 'btn-small', '推演');
    runBtn.addEventListener('click', () => this.runDeduction());
    row.appendChild(runBtn);
    section.appendChild(row);

    this.deductionEl = el('div', 'deduction-chain');
    section.appendChild(this.deductionEl);
    return section;
  }

  private runDeduction(): void {
    const rules = this.deps.getRules();
    const targetId = this.targetSelect.value;
    if (!targetId) {
      this.deductionEl.innerHTML = '';
      this.deductionEl.appendChild(el('div', 'empty-hint', '没有可推演的目标规则。'));
      return;
    }
    const result: DeductionResult = planTarget(this.deps.getCounts(), rules, targetId);
    this.renderDeduction(result);
  }

  private renderDeduction(result: DeductionResult): void {
    this.deductionEl.innerHTML = '';
    const head = el('div', result.success ? 'deduction-ok' : 'deduction-fail');
    head.textContent = result.success
      ? `✔ 目标「${result.targetLabel}」可达成${result.needed.length > 0 ? `，还需投入：${result.needed.map(elementLabel).join('、')}` : '，无需再投入'}`
      : `✘ 目标「${result.targetLabel}」暂不可达成`;
    this.deductionEl.appendChild(head);

    if (result.steps.length === 0) {
      this.deductionEl.appendChild(el('div', 'empty-hint', result.reason));
      return;
    }

    const list = el('ol', 'step-list');
    result.steps.forEach(step => {
      const item = el('li', `step-${step.type}`, step.text);
      list.appendChild(item);
    });
    this.deductionEl.appendChild(list);
    this.deductionEl.appendChild(el('div', 'deduction-reason', result.reason));
  }

  private buildSnapshotSection(): HTMLElement {
    const section = el('section', 'panel-section');
    section.appendChild(el('h3', undefined, '规则快照'));

    const saveRow = el('div', 'field-row');
    this.snapshotNameInput = el('input', 'rule-input wide');
    this.snapshotNameInput.type = 'text';
    this.snapshotNameInput.placeholder = '快照名称';
    saveRow.appendChild(this.snapshotNameInput);
    const saveBtn = el('button', 'btn-small', '保存快照');
    saveBtn.addEventListener('click', () => {
      try {
        this.store.save(this.snapshotNameInput.value, cloneRules(this.deps.getRules()));
        this.snapshotNameInput.value = '';
        this.setStatus('快照已保存。');
      } catch (err) {
        this.setStatus((err as Error).message, true);
      }
    });
    saveRow.appendChild(saveBtn);
    section.appendChild(saveRow);

    this.snapshotListEl = el('div', 'snapshot-list');
    section.appendChild(this.snapshotListEl);

    section.appendChild(el('h4', undefined, '快照比较'));
    const cmpRow = el('div', 'field-row');
    this.compareA = el('select', 'rule-select');
    this.compareB = el('select', 'rule-select');
    const cmpBtn = el('button', 'btn-small', '比较');
    cmpBtn.addEventListener('click', () => this.renderDiff());
    cmpRow.appendChild(this.compareA);
    cmpRow.appendChild(this.compareB);
    cmpRow.appendChild(cmpBtn);
    section.appendChild(cmpRow);

    this.diffEl = el('div', 'diff-result');
    section.appendChild(this.diffEl);
    return section;
  }

  private refreshSnapshots(): void {
    const snapshots = this.store.list();
    this.snapshotListEl.innerHTML = '';

    if (snapshots.length === 0) {
      this.snapshotListEl.appendChild(el('div', 'empty-hint', '还没有快照。保存当前规则集以便日后载入或比较。'));
    }

    for (const snap of snapshots) {
      const row = el('div', 'snapshot-row');
      const date = new Date(snap.createdAt);
      const label = `${snap.name}（${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}）`;
      row.appendChild(el('span', 'snapshot-name', label));

      const loadBtn = el('button', 'btn-small', '载入');
      loadBtn.addEventListener('click', () => {
        const rules = this.store.load(snap.name);
        if (!rules) return;
        this.deps.applyRules(rules);
        this.setStatus(`已载入快照「${snap.name}」，坩埚内已有元素保持不变，后续投料按新规则判定。`);
        this.refresh();
        this.rebuildPairRows();
      });
      row.appendChild(loadBtn);

      const delBtn = el('button', 'btn-danger', '删除');
      delBtn.addEventListener('click', () => {
        this.store.remove(snap.name);
        this.setStatus(`快照「${snap.name}」已删除。`);
      });
      row.appendChild(delBtn);

      this.snapshotListEl.appendChild(row);
    }

    const prevA = this.compareA.value;
    const prevB = this.compareB.value;
    this.compareA.innerHTML = '';
    this.compareB.innerHTML = '';
    for (const snap of snapshots) {
      const optA = el('option', undefined, snap.name);
      optA.value = snap.name;
      this.compareA.appendChild(optA);
      const optB = el('option', undefined, snap.name);
      optB.value = snap.name;
      this.compareB.appendChild(optB);
    }
    if (snapshots.some(s => s.name === prevA)) this.compareA.value = prevA;
    if (snapshots.some(s => s.name === prevB)) this.compareB.value = prevB;
    else if (snapshots.length > 1) this.compareB.value = snapshots[1].name;
  }

  private renderDiff(): void {
    this.diffEl.innerHTML = '';
    const nameA = this.compareA.value;
    const nameB = this.compareB.value;
    const rulesA = nameA ? this.store.load(nameA) : null;
    const rulesB = nameB ? this.store.load(nameB) : null;
    if (!rulesA || !rulesB) {
      this.diffEl.appendChild(el('div', 'empty-hint', '需要两个快照才能比较。'));
      return;
    }

    const diff = diffRuleSets(rulesA, rulesB);
    if (diff.identical) {
      this.diffEl.appendChild(el('div', 'deduction-ok', `「${nameA}」与「${nameB}」完全一致。`));
      return;
    }

    const list = el('ul', 'diff-list');
    if (diff.thresholdChanged) {
      list.appendChild(el('li', 'diff-changed',
        `融合阈值：${diff.thresholdFrom} → ${diff.thresholdTo}` +
        (!diff.thresholdToValid ? '（新阈值不可达）' : '')));
    }
    for (const pair of diff.added) {
      list.appendChild(el('li', 'diff-added', `＋ 新增冲突对：${pairLabel(pair)}「${pair.reaction}」`));
    }
    for (const pair of diff.removed) {
      list.appendChild(el('li', 'diff-removed', `－ 删除冲突对：${pairLabel(pair)}「${pair.reaction}」`));
    }
    for (const mod of diff.modified) {
      const parts: string[] = [];
      if (mod.changes.includes('reaction')) parts.push(`文案「${mod.before.reaction}」→「${mod.after.reaction}」`);
      if (mod.changes.includes('color')) parts.push(`颜色 ${mod.before.color} → ${mod.after.color}`);
      list.appendChild(el('li', 'diff-changed', `✎ 修改冲突对：${pairLabel(mod.after)}（${parts.join('；')}）`));
    }
    this.diffEl.appendChild(list);
  }

  private setStatus(message: string, isError = false): void {
    this.statusEl.textContent = message;
    this.statusEl.className = isError ? 'panel-status error' : 'panel-status';
  }

  refresh(): void {
    const rules = this.deps.getRules();

    if (document.activeElement !== this.thresholdInput) {
      this.thresholdInput.value = String(rules.fusionThreshold);
    }

    const issues = validateRuleSet(rules);
    this.issuesEl.innerHTML = '';
    for (const issue of issues) {
      this.issuesEl.appendChild(el('div', issue.level === 'error' ? 'issue-error' : 'issue-warn', issue.message));
    }

    const counts = this.deps.getCounts();
    const parts = ELEMENT_TYPES.filter(t => counts[t] > 0).map(t => `${elementLabel(t)}×${counts[t]}`);
    this.compositionEl.textContent = parts.length > 0 ? `坩埚内：${parts.join('　')}` : '坩埚内：（空）';

    this.predictionEl.innerHTML = '';
    if (issues.some(i => i.level === 'error' && i.message.includes('规则集为空'))) {
      this.predictionEl.appendChild(el('div', 'empty-hint', '规则集为空：投入元素不会触发任何反应。'));
    } else {
      const resolution = resolveNextReaction(counts, rules);
      if (resolution.reaction) {
        const box = el('div', 'prediction-hit');
        box.appendChild(el('div', undefined, `下一步将触发：${resolution.reaction.label}`));
        box.appendChild(el('div', 'prediction-reason', resolution.reaction.reason));
        this.predictionEl.appendChild(box);
      } else {
        this.predictionEl.appendChild(el('div', 'empty-hint', '当前构成不满足任何规则，继续投料或调整规则。'));
      }
    }

    const prevTarget = this.targetSelect.value;
    this.targetSelect.innerHTML = '';
    for (const ref of enumerateCandidates(rules)) {
      const option = el('option', undefined, ref.label);
      option.value = ref.id;
      this.targetSelect.appendChild(option);
    }
    if ([...this.targetSelect.options].some(o => o.value === prevTarget)) {
      this.targetSelect.value = prevTarget;
    }

    this.refreshSnapshots();
  }
}
