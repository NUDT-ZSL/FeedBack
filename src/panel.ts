import { ElementType } from './elements';
import {
  Counts,
  DeductionResult,
  RuleRef,
  RuleSet,
  Snapshot,
  allMatches,
  conflictRuleRef,
  deduce,
  defaultRules,
  diffRules,
  elementName,
  findTrigger,
  formatCounts,
  fusionRuleRef,
  loadSnapshots,
  makePair,
  pairLabel,
  persistSnapshots,
  ruleRefId,
  validateRules
} from './rules';

const ELEMENT_TYPES: ElementType[] = ['fire', 'water', 'wind', 'earth', 'light', 'dark'];

export interface PanelCallbacks {
  getCounts: () => Counts;
  onRulesChanged: (rules: RuleSet) => void;
}

export class RulePanel {
  private root: HTMLElement;
  private callbacks: PanelCallbacks;
  private rules: RuleSet;
  private snapshots: Snapshot[];
  private deduceTargetId: string | null = null;
  private deduction: DeductionResult | null = null;
  private compareA: number = -1;
  private compareB: number = -1;

  constructor(root: HTMLElement, callbacks: PanelCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.rules = defaultRules();
    this.snapshots = loadSnapshots();
    this.render();
  }

  getRules(): RuleSet {
    return this.rules;
  }

  refreshDeduction(): void {
    this.renderDeduction();
  }

  private emitRulesChanged(): void {
    this.callbacks.onRulesChanged(this.rules);
  }

  private render(): void {
    this.root.innerHTML = `
      <h2 class="rp-title">规则配置</h2>
      <section class="rp-section" id="rp-rules"></section>
      <section class="rp-section" id="rp-deduction"></section>
      <section class="rp-section" id="rp-snapshots"></section>
    `;
    this.renderRules();
    this.renderDeduction();
    this.renderSnapshots();
  }

  // ---------- 规则编辑 ----------

  private renderRules(): void {
    const section = this.root.querySelector<HTMLElement>('#rp-rules');
    if (!section) return;

    const warnings = validateRules(this.rules);
    const thresholdValid = Number.isInteger(this.rules.fusionThreshold) && this.rules.fusionThreshold >= 1;

    const pairRows = this.rules.pairs.map((pair, index) => `
      <div class="rp-pair" data-pair-id="${pair.id}">
        <div class="rp-pair-head">
          <span class="rp-pair-index">#${index + 1}</span>
          <select class="rp-select rp-elem-a">${this.elementOptions(pair.a)}</select>
          <span class="rp-times">×</span>
          <select class="rp-select rp-elem-b">${this.elementOptions(pair.b)}</select>
          <input type="color" class="rp-color" value="${pair.color}" title="反应颜色" />
          <button class="rp-btn rp-btn-danger rp-del-pair" title="删除该冲突对">删</button>
        </div>
        <input type="text" class="rp-input rp-reaction" placeholder="反应文案…" value="${escapeAttr(pair.reaction)}" />
      </div>
    `).join('');

    section.innerHTML = `
      <h3 class="rp-subtitle">规则集</h3>
      <div class="rp-row">
        <label class="rp-label">融合阈值</label>
        <input type="number" class="rp-input rp-threshold" min="1" step="1"
               value="${Number.isNaN(this.rules.fusionThreshold) ? '' : this.rules.fusionThreshold}" />
        <span class="rp-hint">个同元素触发融合</span>
      </div>
      ${thresholdValid ? '' : '<div class="rp-empty">阈值无效时融合规则停用，仅冲突对生效</div>'}
      <div class="rp-warnings">${warnings.map(w => `<div class="rp-warning">⚠ ${w.message}</div>`).join('')}</div>
      <div class="rp-row rp-row-head">
        <label class="rp-label">冲突对（按列表顺序判定，靠前者优先）</label>
      </div>
      ${pairRows || '<div class="rp-empty">当前没有冲突对规则，只有融合规则会生效。点击下方按钮添加。</div>'}
      <button class="rp-btn rp-add-pair">+ 添加冲突对</button>
    `;

    const thresholdInput = section.querySelector<HTMLInputElement>('.rp-threshold');
    thresholdInput?.addEventListener('input', () => {
      this.rules.fusionThreshold = thresholdInput.value === '' ? NaN : Number(thresholdInput.value);
      this.emitRulesChanged();
      this.renderRules();
      this.renderDeduction();
      const fresh = this.root.querySelector<HTMLInputElement>('.rp-threshold');
      if (fresh) fresh.focus();
    });

    section.querySelector<HTMLButtonElement>('.rp-add-pair')?.addEventListener('click', () => {
      this.rules.pairs.push(makePair('fire', 'water', '', '#ffcc66'));
      this.emitRulesChanged();
      this.renderRules();
      this.renderDeduction();
    });

    section.querySelectorAll<HTMLElement>('.rp-pair').forEach(row => {
      const pairId = row.dataset.pairId!;
      const pair = this.rules.pairs.find(p => p.id === pairId);
      if (!pair) return;

      row.querySelector<HTMLSelectElement>('.rp-elem-a')?.addEventListener('change', (e) => {
        pair.a = (e.target as HTMLSelectElement).value as ElementType;
        this.emitRulesChanged();
        this.renderRules();
        this.renderDeduction();
      });
      row.querySelector<HTMLSelectElement>('.rp-elem-b')?.addEventListener('change', (e) => {
        pair.b = (e.target as HTMLSelectElement).value as ElementType;
        this.emitRulesChanged();
        this.renderRules();
        this.renderDeduction();
      });
      row.querySelector<HTMLInputElement>('.rp-color')?.addEventListener('input', (e) => {
        pair.color = (e.target as HTMLInputElement).value;
        this.emitRulesChanged();
      });
      row.querySelector<HTMLInputElement>('.rp-reaction')?.addEventListener('input', (e) => {
        pair.reaction = (e.target as HTMLInputElement).value;
        this.emitRulesChanged();
        this.renderDeduction();
      });
      row.querySelector<HTMLButtonElement>('.rp-del-pair')?.addEventListener('click', () => {
        this.rules.pairs = this.rules.pairs.filter(p => p.id !== pairId);
        this.emitRulesChanged();
        this.renderRules();
        this.renderDeduction();
      });
    });
  }

  private elementOptions(selected: ElementType): string {
    return ELEMENT_TYPES.map(t =>
      `<option value="${t}" ${t === selected ? 'selected' : ''}>${elementName(t)}</option>`
    ).join('');
  }

  // ---------- 推演 ----------

  private allRuleRefs(): RuleRef[] {
    const fusionRefs = ELEMENT_TYPES.map(t => fusionRuleRef(this.rules, t));
    const conflictRefs = this.rules.pairs.map((p, i) => conflictRuleRef(p, i));
    return [...fusionRefs, ...conflictRefs];
  }

  private renderDeduction(): void {
    const section = this.root.querySelector<HTMLElement>('#rp-deduction');
    if (!section) return;

    const counts = this.callbacks.getCounts();
    const matches = allMatches(this.rules, counts);
    const next = findTrigger(this.rules, counts);

    const refs = this.allRuleRefs();
    if (this.deduceTargetId && !refs.some(r => ruleRefId(r) === this.deduceTargetId)) {
      this.deduceTargetId = null;
      this.deduction = null;
    }

    const targetOptions = refs.map(r =>
      `<option value="${ruleRefId(r)}" ${ruleRefId(r) === this.deduceTargetId ? 'selected' : ''}>${r.label}</option>`
    ).join('');

    let chainHtml = '';
    if (this.deduction) {
      const d = this.deduction;
      const neededText = formatCounts(d.needed) === '空' ? '无需再投入' : formatCounts(d.needed);
      const stepsHtml = d.steps.map((s, i) =>
        `<li class="rp-step rp-step-${s.kind}">${i + 1}. ${s.text}</li>`
      ).join('');
      chainHtml = `
        <div class="rp-chain ${d.reachable ? 'rp-chain-ok' : 'rp-chain-fail'}">
          <div class="rp-chain-verdict">${d.reachable ? `✔ 可达，还需投入：${neededText}` : `✘ 不可达：${d.reason}`}</div>
          ${d.steps.length > 0 ? `<ol class="rp-steps">${stepsHtml}</ol>` : ''}
          ${d.usedRules.length > 0 ? `<div class="rp-rules-used">依据规则：${d.usedRules.join('、')}</div>` : ''}
        </div>
      `;
    }

    section.innerHTML = `
      <h3 class="rp-subtitle">规则推演</h3>
      <div class="rp-row"><span class="rp-label">坩埚现状</span><span class="rp-value">${formatCounts(counts)}</span></div>
      <div class="rp-next">
        ${next
          ? `<div class="rp-next-hit">下一条将触发：<b>${next.rule.label}</b> —— ${next.result}</div>
             <div class="rp-next-reason">${next.reason}</div>`
          : `<div class="rp-empty">当前坩埚构成不会触发任何反应${matches.length === 0 && this.rules.pairs.length === 0 ? '（规则集为空）' : ''}</div>`}
      </div>
      <div class="rp-row">
        <label class="rp-label">目标反应</label>
        <select class="rp-select rp-target">
          <option value="">选择要推演的规则…</option>
          ${targetOptions}
        </select>
        <button class="rp-btn rp-run-deduce" ${this.deduceTargetId ? '' : 'disabled'}>推演</button>
      </div>
      ${chainHtml}
    `;

    section.querySelector<HTMLSelectElement>('.rp-target')?.addEventListener('change', (e) => {
      this.deduceTargetId = (e.target as HTMLSelectElement).value || null;
      this.renderDeduction();
    });
    section.querySelector<HTMLButtonElement>('.rp-run-deduce')?.addEventListener('click', () => {
      const target = this.allRuleRefs().find(r => ruleRefId(r) === this.deduceTargetId);
      if (!target) return;
      this.deduction = deduce(this.rules, this.callbacks.getCounts(), target);
      this.renderDeduction();
    });
  }

  // ---------- 快照 ----------

  private renderSnapshots(): void {
    const section = this.root.querySelector<HTMLElement>('#rp-snapshots');
    if (!section) return;

    const listHtml = this.snapshots.map((snap, index) => {
      const time = new Date(snap.createdAt);
      const timeStr = `${pad2(time.getMonth() + 1)}-${pad2(time.getDate())} ${pad2(time.getHours())}:${pad2(time.getMinutes())}`;
      return `
        <div class="rp-snap" data-index="${index}">
          <span class="rp-snap-name" title="${escapeAttr(snap.name)}">${escapeHtml(snap.name)}</span>
          <span class="rp-snap-time">${timeStr}</span>
          <button class="rp-btn rp-load-snap">载入</button>
          <button class="rp-btn rp-btn-danger rp-del-snap">删</button>
        </div>
      `;
    }).join('');

    const options = (selected: number) =>
      `<option value="-1">选择快照…</option>` +
      this.snapshots.map((s, i) =>
        `<option value="${i}" ${i === selected ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
      ).join('');

    section.innerHTML = `
      <h3 class="rp-subtitle">规则快照</h3>
      <div class="rp-row">
        <input type="text" class="rp-input rp-snap-name-input" placeholder="快照名称…" maxlength="20" />
        <button class="rp-btn rp-save-snap">保存快照</button>
      </div>
      ${listHtml || '<div class="rp-empty">还没有快照，保存一份当前规则集以便对比和回滚。</div>'}
      <div class="rp-row rp-row-head"><label class="rp-label">快照对比</label></div>
      <div class="rp-row">
        <select class="rp-select rp-compare-a">${options(this.compareA)}</select>
        <span class="rp-times">⇄</span>
        <select class="rp-select rp-compare-b">${options(this.compareB)}</select>
      </div>
      <div class="rp-diff" id="rp-diff-result">${this.renderDiff()}</div>
    `;

    section.querySelector<HTMLButtonElement>('.rp-save-snap')?.addEventListener('click', () => {
      const input = section.querySelector<HTMLInputElement>('.rp-snap-name-input');
      const name = (input?.value ?? '').trim() || `快照 ${this.snapshots.length + 1}`;
      this.snapshots.push({
        name,
        createdAt: Date.now(),
        rules: JSON.parse(JSON.stringify(this.rules)) as RuleSet
      });
      persistSnapshots(this.snapshots);
      this.renderSnapshots();
    });

    section.querySelectorAll<HTMLElement>('.rp-snap').forEach(row => {
      const index = Number(row.dataset.index);
      row.querySelector<HTMLButtonElement>('.rp-load-snap')?.addEventListener('click', () => {
        const snap = this.snapshots[index];
        if (!snap) return;
        this.rules = JSON.parse(JSON.stringify(snap.rules)) as RuleSet;
        this.sanitizeLoadedRules();
        this.deduction = null;
        this.emitRulesChanged();
        this.renderRules();
        this.renderDeduction();
      });
      row.querySelector<HTMLButtonElement>('.rp-del-snap')?.addEventListener('click', () => {
        this.snapshots.splice(index, 1);
        if (this.compareA === index) this.compareA = -1;
        if (this.compareB === index) this.compareB = -1;
        if (this.compareA > index) this.compareA -= 1;
        if (this.compareB > index) this.compareB -= 1;
        persistSnapshots(this.snapshots);
        this.renderSnapshots();
      });
    });

    section.querySelector<HTMLSelectElement>('.rp-compare-a')?.addEventListener('change', (e) => {
      this.compareA = Number((e.target as HTMLSelectElement).value);
      this.renderSnapshots();
    });
    section.querySelector<HTMLSelectElement>('.rp-compare-b')?.addEventListener('change', (e) => {
      this.compareB = Number((e.target as HTMLSelectElement).value);
      this.renderSnapshots();
    });
  }

  private sanitizeLoadedRules(): void {
    if (!Array.isArray(this.rules.pairs)) this.rules.pairs = [];
    this.rules.pairs = this.rules.pairs.filter(p =>
      ELEMENT_TYPES.includes(p.a) && ELEMENT_TYPES.includes(p.b)
    );
    for (const pair of this.rules.pairs) {
      if (!pair.id) pair.id = makePair(pair.a, pair.b).id;
      if (typeof pair.reaction !== 'string') pair.reaction = '';
      if (typeof pair.color !== 'string') pair.color = '#ffffff';
    }
    if (typeof this.rules.fusionThreshold !== 'number') this.rules.fusionThreshold = NaN;
  }

  private renderDiff(): string {
    const a = this.snapshots[this.compareA];
    const b = this.snapshots[this.compareB];
    if (!a || !b) return '<div class="rp-empty">选择两个快照查看差异</div>';
    if (a === b) return '<div class="rp-empty">请选择两个不同的快照</div>';

    const diff = diffRules(a.rules, b.rules);
    const parts: string[] = [];

    if (diff.threshold) {
      parts.push(`<div class="rp-diff-item rp-diff-mod">融合阈值：${diff.threshold.from} → ${diff.threshold.to}</div>`);
    }
    for (const p of diff.addedPairs) {
      parts.push(`<div class="rp-diff-item rp-diff-add">+ 新增冲突对「${pairLabel(p.a, p.b)}」${p.reaction ? `：${escapeHtml(p.reaction)}` : ''}</div>`);
    }
    for (const p of diff.removedPairs) {
      parts.push(`<div class="rp-diff-item rp-diff-del">− 删除冲突对「${pairLabel(p.a, p.b)}」${p.reaction ? `：${escapeHtml(p.reaction)}` : ''}</div>`);
    }
    for (const m of diff.modifiedPairs) {
      parts.push(`<div class="rp-diff-item rp-diff-mod">~ 修改冲突对「${pairLabel(m.after.a, m.after.b)}」（${m.changes.join('、')}）</div>`);
    }

    if (parts.length === 0) return '<div class="rp-empty">两份快照的规则完全一致</div>';
    return parts.join('');
  }
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}
