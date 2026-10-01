import type { WordCategory, CategoryKey } from './wordManager';
import { wordCategories } from './wordManager';

export interface RoundRecordUI {
  round: number;
  picker: 'A' | 'B';
  word: string;
  correct: boolean;
  scoreA: number;
  scoreB: number;
}

export interface UIHandlers {
  onStartGame: () => void;
  onSelectWord: (word: string) => void;
  onConfirmWord: () => void;
  onSubmitGuess: (guess: string) => void;
  onClearHistory: () => void;
  onRestart: () => void;
}

let audioCtx: AudioContext | null = null;
let activeTimerId: number | null = null;
let activeRafId: number | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

export function playKeystrokeSound(): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.type = 'square';
    oscillator.frequency.value = 1800 + Math.random() * 600;
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.045);
  } catch {
    // ignore audio errors
  }
}

export function playDingSound(correct: boolean): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.type = correct ? 'sine' : 'sawtooth';
    oscillator.frequency.value = correct ? 880 : 220;
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.32);
  } catch {
    // ignore
  }
}

export function cancelAllTimers(): void {
  if (activeTimerId !== null) {
    window.clearTimeout(activeTimerId);
    activeTimerId = null;
  }
  if (activeRafId !== null) {
    window.cancelAnimationFrame(activeRafId);
    activeRafId = null;
  }
}

function fadeIn(el: HTMLElement): void {
  el.style.opacity = '0';
  el.style.transform = 'translateY(15px)';
  el.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  });
}

function clearNode(node: HTMLElement): void {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

export interface UIController {
  root: HTMLElement;
  gameCard: HTMLElement;
  init: () => void;
  setHandlers: (h: UIHandlers) => void;
  renderWelcome: () => void;
  renderStatus: (round: number, total: number, scoreA: number, scoreB: number, activePlayer: 'A' | 'B') => void;
  renderWordPicker: (selectedWord: string | null) => void;
  renderWaitingForHints: () => void;
  renderGuessPanel: (hints: string[], currentHintIndex: number, partialHint: string, showTypingCursor: boolean) => void;
  updateHintTyping: (index: number, text: string, showCursor: boolean) => void;
  setCountdown: (secondsLeft: number, totalSeconds: number) => void;
  focusGuessInput: () => void;
  getGuessInputValue: () => string;
  clearGuessInput: () => void;
  flashCorrect: () => void;
  flashWrong: () => void;
  showFloatingScore: (value: number) => void;
  renderGameOver: (scoreA: number, scoreB: number) => void;
  renderHistory: (records: RoundRecordUI[]) => void;
  toggleTabletCollapse: () => void;
  toggleMobileDrawer: (open: boolean) => void;
}

export function createUIController(root: HTMLElement): UIController {
  let handlers: UIHandlers | null = null;
  let currentSelectedCategory: CategoryKey = 'animal';
  let currentSelectedWord: string | null = null;
  let hintEls: HTMLElement[] = [];
  let countdownEl: HTMLElement | null = null;
  let guessInputEl: HTMLInputElement | null = null;
  let tabletOpen = false;

  function buildBaseLayout(): void {
    clearNode(root);
    root.className = 'game-layout';

    const main = document.createElement('div');
    main.className = 'game-main';
    main.id = 'game-main';

    const statusBar = document.createElement('div');
    statusBar.className = 'glass-card status-bar';
    statusBar.id = 'status-bar';

    const gameCard = document.createElement('div');
    gameCard.className = 'glass-card game-card';
    gameCard.id = 'game-card';

    main.appendChild(statusBar);
    main.appendChild(gameCard);

    const sidebar = document.createElement('div');
    sidebar.className = 'game-sidebar';
    sidebar.id = 'game-sidebar';

    const tabletCollapseBtn = document.createElement('button');
    tabletCollapseBtn.className = 'collapse-btn';
    tabletCollapseBtn.id = 'tablet-collapse-btn';
    tabletCollapseBtn.innerHTML = `<span>历史记录与得分趋势</span><span class="collapse-arrow" id="collapse-arrow">▼</span>`;

    const tabletCollapse = document.createElement('div');
    tabletCollapse.className = 'tablet-collapse';
    tabletCollapse.id = 'tablet-collapse';

    const historyCard = document.createElement('div');
    historyCard.className = 'glass-card sidebar-section';
    historyCard.id = 'history-card';

    const chartCard = document.createElement('div');
    chartCard.className = 'glass-card sidebar-section';
    chartCard.id = 'chart-card';

    sidebar.appendChild(tabletCollapseBtn);
    tabletCollapse.appendChild(historyCard);
    tabletCollapse.appendChild(chartCard);
    sidebar.appendChild(tabletCollapse);

    root.appendChild(main);
    root.appendChild(sidebar);

    const mobileToggle = document.createElement('button');
    mobileToggle.className = 'mobile-toggle-btn';
    mobileToggle.id = 'mobile-toggle-btn';
    mobileToggle.textContent = '📋';

    const drawerOverlay = document.createElement('div');
    drawerOverlay.className = 'drawer-overlay';
    drawerOverlay.id = 'drawer-overlay';

    const mobileDrawer = document.createElement('div');
    mobileDrawer.className = 'mobile-drawer';
    mobileDrawer.id = 'mobile-drawer';
    mobileDrawer.innerHTML = '<div class="drawer-handle"></div>';

    const mobileHistory = historyCard.cloneNode(true) as HTMLElement;
    mobileHistory.id = 'history-card-mobile';
    const mobileChart = chartCard.cloneNode(true) as HTMLElement;
    mobileChart.id = 'chart-card-mobile';
    mobileDrawer.appendChild(mobileHistory);
    mobileDrawer.appendChild(mobileChart);

    root.appendChild(mobileToggle);
    root.appendChild(drawerOverlay);
    root.appendChild(mobileDrawer);

    tabletCollapseBtn.addEventListener('click', () => {
      tabletOpen = !tabletOpen;
      tabletCollapse.classList.toggle('open', tabletOpen);
      const arrow = document.getElementById('collapse-arrow');
      if (arrow) arrow.classList.toggle('open', tabletOpen);
    });

    mobileToggle.addEventListener('click', () => toggleMobileDrawer(true));
    drawerOverlay.addEventListener('click', () => toggleMobileDrawer(false));
  }

  function renderStatus(round: number, total: number, scoreA: number, scoreB: number, activePlayer: 'A' | 'B'): void {
    const statusBar = document.getElementById('status-bar');
    if (!statusBar) return;
    clearNode(statusBar);

    const scores = document.createElement('div');
    scores.className = 'status-scores';

    const boxA = document.createElement('div');
    boxA.className = 'score-box' + (activePlayer === 'A' ? ' active' : '');
    boxA.innerHTML = `<div class="score-label">玩家 A</div><div class="score-value">${scoreA}</div>`;

    const boxB = document.createElement('div');
    boxB.className = 'score-box' + (activePlayer === 'B' ? ' active' : '');
    boxB.innerHTML = `<div class="score-label">玩家 B</div><div class="score-value">${scoreB}</div>`;

    scores.appendChild(boxA);
    scores.appendChild(boxB);

    const roundInfo = document.createElement('div');
    roundInfo.className = 'round-info';
    roundInfo.innerHTML = `<div class="round-label">轮次</div><div class="round-value">${round} / ${total}</div>`;

    const role = document.createElement('div');
    role.className = 'current-role';
    role.textContent = `玩家${activePlayer} 出词中`;

    statusBar.appendChild(scores);
    statusBar.appendChild(roundInfo);
    statusBar.appendChild(role);
  }

  function renderWelcome(): void {
    const card = document.getElementById('game-card');
    if (!card) return;
    clearNode(card);
    const welcome = document.createElement('div');
    welcome.className = 'welcome-screen';
    welcome.innerHTML = `
      <h1 class="welcome-title">猜词对抗</h1>
      <p class="welcome-subtitle">双人文字默契挑战 · 轮流出词 · 限时竞猜<br>根据提示猜出对方心里的词，看看你们的默契有多高！</p>
      <button class="btn btn-primary" id="start-btn">开始游戏</button>
    `;
    card.appendChild(welcome);
    fadeIn(welcome);
    const btn = document.getElementById('start-btn');
    if (btn && handlers) {
      btn.addEventListener('click', handlers.onStartGame);
    }
  }

  function renderWordPicker(selectedWord: string | null): void {
    currentSelectedWord = selectedWord;
    const card = document.getElementById('game-card');
    if (!card) return;
    clearNode(card);

    const picker = document.createElement('div');
    picker.className = 'word-picker';

    const title = document.createElement('div');
    title.className = 'picker-title';
    title.textContent = '请选择或输入一个词';
    picker.appendChild(title);

    const tabs = document.createElement('div');
    tabs.className = 'category-tabs';
    wordCategories.forEach(cat => {
      const tab = document.createElement('button');
      tab.className = 'category-tab' + (cat.key === currentSelectedCategory ? ' active' : '');
      tab.textContent = cat.label;
      tab.addEventListener('click', () => {
        currentSelectedCategory = cat.key;
        renderCategoryWords(tabs.nextElementSibling as HTMLElement | null);
        tabs.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
      });
      tabs.appendChild(tab);
    });
    picker.appendChild(tabs);

    const grid = document.createElement('div');
    grid.className = 'words-grid';
    picker.appendChild(grid);
    renderCategoryWords(grid);

    const customWrap = document.createElement('div');
    customWrap.className = 'custom-input-wrap';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'custom-input';
    input.placeholder = '或自定义输入一个词（1-10字）';
    input.maxLength = 10;
    input.addEventListener('input', () => {
      currentSelectedWord = input.value.trim() || null;
      updateSelectedHint();
      highlightSelectedWord();
    });
    customWrap.appendChild(input);
    picker.appendChild(customWrap);

    const hint = document.createElement('div');
    hint.className = 'selected-hint';
    hint.id = 'selected-hint';
    picker.appendChild(hint);
    updateSelectedHint();

    const footer = document.createElement('div');
    footer.className = 'picker-footer';
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn btn-primary';
    confirmBtn.id = 'confirm-word-btn';
    confirmBtn.textContent = '确认出词';
    confirmBtn.disabled = !currentSelectedWord;
    confirmBtn.addEventListener('click', () => {
      if (handlers && currentSelectedWord) handlers.onConfirmWord();
    });
    footer.appendChild(confirmBtn);
    picker.appendChild(footer);

    card.appendChild(picker);
    fadeIn(picker);

    function updateSelectedHint(): void {
      const h = document.getElementById('selected-hint') as HTMLDivElement | null;
      const btn = document.getElementById('confirm-word-btn') as HTMLButtonElement | null;
      if (h) h.textContent = currentSelectedWord ? `已选择：${currentSelectedWord}` : '';
      if (btn) btn.disabled = !currentSelectedWord;
    }

    function highlightSelectedWord(): void {
      const items = grid.querySelectorAll('.word-item');
      items.forEach(item => {
        item.classList.toggle('selected', item.textContent === currentSelectedWord);
      });
    }
  }

  function renderCategoryWords(grid: HTMLElement | null): void {
    if (!grid) return;
    clearNode(grid);
    const words = wordCategories.find(c => c.key === currentSelectedCategory)?.words ?? [];
    words.forEach(word => {
      const item = document.createElement('div');
      item.className = 'word-item' + (word === currentSelectedWord ? ' selected' : '');
      item.textContent = word;
      item.addEventListener('click', () => {
        currentSelectedWord = word;
        const customInput = document.querySelector('.custom-input') as HTMLInputElement | null;
        if (customInput) customInput.value = '';
        grid.querySelectorAll('.word-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        const h = document.getElementById('selected-hint') as HTMLDivElement | null;
        if (h) h.textContent = `已选择：${word}`;
        const btn = document.getElementById('confirm-word-btn') as HTMLButtonElement | null;
        if (btn) btn.disabled = false;
        if (handlers) handlers.onSelectWord(word);
      });
      grid.appendChild(item);
    });
  }

  function renderWaitingForHints(): void {
    const card = document.getElementById('game-card');
    if (!card) return;
    clearNode(card);
    const wrap = document.createElement('div');
    wrap.className = 'waiting-text';
    wrap.innerHTML = `
      <div>正在生成提示...</div>
      <div class="loading-dots"><span></span><span></span><span></span></div>
    `;
    card.appendChild(wrap);
    fadeIn(wrap);
  }

  function renderGuessPanel(hints: string[], currentHintIndex: number, partialHint: string, showTypingCursor: boolean): void {
    const card = document.getElementById('game-card');
    if (!card) return;
    clearNode(card);
    hintEls = [];

    const panel = document.createElement('div');
    panel.className = 'guess-panel';

    const hintsContainer = document.createElement('div');
    hintsContainer.className = 'hints-container';

    hints.forEach((hintText, i) => {
      const el = document.createElement('div');
      el.className = 'hint-item';
      if (i < currentHintIndex) {
        el.textContent = hintText;
      } else if (i === currentHintIndex) {
        el.classList.add('current');
        el.innerHTML = `<span class="hint-text"></span><span class="cursor"></span>`;
        const textSpan = el.querySelector('.hint-text') as HTMLSpanElement;
        if (textSpan) textSpan.textContent = partialHint;
        if (!showTypingCursor) {
          const c = el.querySelector('.cursor');
          if (c) c.remove();
        }
      } else {
        el.classList.add('pending');
        el.textContent = '···';
      }
      hintsContainer.appendChild(el);
      hintEls.push(el);
    });

    panel.appendChild(hintsContainer);

    const cdWrap = document.createElement('div');
    cdWrap.className = 'countdown-wrap';
    countdownEl = document.createElement('div');
    countdownEl.className = 'countdown-number';
    countdownEl.textContent = '3';
    cdWrap.appendChild(countdownEl);
    panel.appendChild(cdWrap);

    const inputWrap = document.createElement('div');
    inputWrap.className = 'guess-input-wrap';
    guessInputEl = document.createElement('input');
    guessInputEl.type = 'text';
    guessInputEl.className = 'guess-input';
    guessInputEl.placeholder = '输入你的猜测，按回车或点击按钮提交';
    guessInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && handlers) {
        handlers.onSubmitGuess(guessInputEl?.value ?? '');
      }
    });
    const submitBtn = document.createElement('button');
    submitBtn.className = 'btn btn-primary';
    submitBtn.textContent = '提交';
    submitBtn.addEventListener('click', () => {
      if (handlers) handlers.onSubmitGuess(guessInputEl?.value ?? '');
    });
    inputWrap.appendChild(guessInputEl);
    inputWrap.appendChild(submitBtn);
    panel.appendChild(inputWrap);

    card.appendChild(panel);
    fadeIn(panel);
  }

  function updateHintTyping(index: number, text: string, showCursor: boolean): void {
    if (!hintEls[index]) return;
    const el = hintEls[index];
    el.classList.add('current');
    const textSpan = el.querySelector('.hint-text');
    const cursorEl = el.querySelector('.cursor');
    if (textSpan) {
      textSpan.textContent = text;
    } else {
      el.innerHTML = `<span class="hint-text">${text}</span>`;
    }
    if (showCursor) {
      if (!el.querySelector('.cursor')) {
        const c = document.createElement('span');
        c.className = 'cursor';
        el.appendChild(c);
      }
    } else {
      if (cursorEl) cursorEl.remove();
    }
  }

  function setCountdown(secondsLeft: number, totalSeconds: number): void {
    if (!countdownEl) return;
    countdownEl.textContent = String(Math.max(0, Math.ceil(secondsLeft)));
    if (secondsLeft <= 3) {
      countdownEl.classList.add('danger');
    } else {
      countdownEl.classList.remove('danger');
    }
    void totalSeconds;
  }

  function focusGuessInput(): void {
    setTimeout(() => guessInputEl?.focus(), 50);
  }

  function getGuessInputValue(): string {
    return guessInputEl?.value ?? '';
  }

  function clearGuessInput(): void {
    if (guessInputEl) guessInputEl.value = '';
  }

  function flashCorrect(): void {
    const card = document.getElementById('game-card');
    if (!card) return;
    card.classList.remove('flash-correct', 'flash-wrong');
    void card.offsetWidth;
    card.classList.add('flash-correct');
    playDingSound(true);
    setTimeout(() => card.classList.remove('flash-correct'), 500);
  }

  function flashWrong(): void {
    const card = document.getElementById('game-card');
    if (!card) return;
    card.classList.remove('flash-correct', 'flash-wrong');
    void card.offsetWidth;
    card.classList.add('flash-wrong');
    playDingSound(false);
    setTimeout(() => card.classList.remove('flash-wrong'), 400);
  }

  function showFloatingScore(value: number): void {
    const card = document.getElementById('game-card');
    if (!card) return;
    const el = document.createElement('div');
    el.className = 'floating-score';
    el.textContent = value >= 0 ? `+${value}` : String(value);
    card.appendChild(el);
    setTimeout(() => el.remove(), 2100);
  }

  function renderGameOver(scoreA: number, scoreB: number): void {
    const card = document.getElementById('game-card');
    if (!card) return;
    clearNode(card);

    let titleClass = 'draw';
    let titleText = '平局！势均力敌';
    if (scoreA > scoreB) {
      titleClass = 'win-a';
      titleText = '🎉 玩家 A 获胜！';
    } else if (scoreB > scoreA) {
      titleClass = 'win-b';
      titleText = '🎉 玩家 B 获胜！';
    }

    const end = document.createElement('div');
    end.className = 'end-screen';
    end.innerHTML = `
      <div class="end-title ${titleClass}">${titleText}</div>
      <div class="end-scores">
        <div class="end-score-box">
          <div class="score-label">玩家 A</div>
          <div class="score-value">${scoreA}</div>
        </div>
        <div class="end-vs">VS</div>
        <div class="end-score-box">
          <div class="score-label">玩家 B</div>
          <div class="score-value">${scoreB}</div>
        </div>
      </div>
      <button class="btn btn-primary" id="restart-btn">再来一局</button>
    `;
    card.appendChild(end);
    fadeIn(end);
    const btn = document.getElementById('restart-btn');
    if (btn && handlers) btn.addEventListener('click', handlers.onRestart);
  }

  function renderHistorySection(container: HTMLElement, records: RoundRecordUI[], withChart: boolean): void {
    clearNode(container);
    container.className = 'glass-card sidebar-section';

    const title = document.createElement('div');
    title.className = 'sidebar-title';
    const titleText = document.createElement('span');
    titleText.textContent = '本局记录';
    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn-danger btn-sm';
    clearBtn.textContent = '清空';
    clearBtn.addEventListener('click', () => handlers?.onClearHistory());
    title.appendChild(titleText);
    title.appendChild(clearBtn);
    container.appendChild(title);

    if (records.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-history';
      empty.textContent = '暂无记录，开始游戏吧';
      container.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'history-list';
      records.forEach(r => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
          <span class="round-num">R${r.round}</span>
          <span class="word-text">${r.word}</span>
          <span class="result-badge ${r.correct ? 'correct' : 'wrong'}">${r.correct ? '猜对' : '猜错'}</span>
          <span class="score-detail">${r.scoreA}:${r.scoreB}</span>
        `;
        list.appendChild(item);
      });
      container.appendChild(list);
    }

    if (withChart && records.length > 0) {
      // Chart will be rendered separately in chart card
    }
  }

  function renderChart(container: HTMLElement, records: RoundRecordUI[]): void {
    clearNode(container);
    container.className = 'glass-card sidebar-section';
    const title = document.createElement('div');
    title.className = 'sidebar-title';
    title.textContent = '得分趋势';
    container.appendChild(title);

    const wrap = document.createElement('div');
    wrap.className = 'chart-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'chart-canvas';
    wrap.appendChild(canvas);
    container.appendChild(wrap);

    requestAnimationFrame(() => drawScoreChart(canvas, records));
  }

  function drawScoreChart(canvas: HTMLCanvasElement, records: RoundRecordUI[]): void {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const padL = 24, padR = 12, padT = 16, padB = 20;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    ctx.clearRect(0, 0, w, h);

    if (records.length === 0) return;

    const dataA = [0, ...records.map(r => r.scoreA)];
    const dataB = [0, ...records.map(r => r.scoreB)];
    const n = dataA.length;
    const maxScore = Math.max(10, ...dataA, ...dataB);

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const val = Math.round(maxScore - (maxScore * i) / 4);
      const y = padT + (plotH * i) / 4;
      ctx.fillText(String(val), padL - 4, y + 3);
    }

    function xFor(i: number): number {
      if (n <= 1) return padL + plotW / 2;
      return padL + (plotW * i) / (n - 1);
    }
    function yFor(v: number): number {
      return padT + plotH - (plotH * v) / maxScore;
    }

    function drawLine(data: number[], color: string, shadow: string): void {
      ctx.save();
      ctx.strokeStyle = shadow;
      ctx.lineWidth = 5;
      ctx.shadowBlur = 8;
      ctx.shadowColor = shadow;
      ctx.beginPath();
      data.forEach((v, i) => {
        const x = xFor(i);
        const y = yFor(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.restore();

      ctx.save();
      const gradient = ctx.createLinearGradient(padL, 0, padL + plotW, 0);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, shadow);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      data.forEach((v, i) => {
        const x = xFor(i);
        const y = yFor(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.restore();

      data.forEach((v, i) => {
        const x = xFor(i);
        const y = yFor(v);
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#16213e';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.stroke();
      });
    }

    drawLine(dataA, '#64b5f6', 'rgba(100, 181, 246, 0.4)');
    drawLine(dataB, '#ffab91', 'rgba(255, 171, 145, 0.4)');
  }

  function renderHistory(records: RoundRecordUI[]): void {
    const historyCard = document.getElementById('history-card');
    const chartCard = document.getElementById('chart-card');
    const historyMobile = document.getElementById('history-card-mobile');
    const chartMobile = document.getElementById('chart-card-mobile');
    if (historyCard) renderHistorySection(historyCard, records, true);
    if (chartCard) renderChart(chartCard, records);
    if (historyMobile) renderHistorySection(historyMobile, records, true);
    if (chartMobile) renderChart(chartMobile, records);
  }

  function toggleTabletCollapse(): void {
    tabletOpen = !tabletOpen;
    const tc = document.getElementById('tablet-collapse');
    const arrow = document.getElementById('collapse-arrow');
    if (tc) tc.classList.toggle('open', tabletOpen);
    if (arrow) arrow.classList.toggle('open', tabletOpen);
  }

  function toggleMobileDrawer(open: boolean): void {
    const overlay = document.getElementById('drawer-overlay');
    const drawer = document.getElementById('mobile-drawer');
    if (overlay) overlay.classList.toggle('open', open);
    if (drawer) drawer.classList.toggle('open', open);
  }

  return {
    root,
    get gameCard() { return document.getElementById('game-card') ?? root; },
    init() {
      buildBaseLayout();
      renderStatus(0, 5, 0, 0, 'A');
      renderWelcome();
      renderHistory([]);
    },
    setHandlers(h: UIHandlers) { handlers = h; },
    renderWelcome,
    renderStatus,
    renderWordPicker,
    renderWaitingForHints,
    renderGuessPanel,
    updateHintTyping,
    setCountdown,
    focusGuessInput,
    getGuessInputValue,
    clearGuessInput,
    flashCorrect,
    flashWrong,
    showFloatingScore,
    renderGameOver,
    renderHistory,
    toggleTabletCollapse,
    toggleMobileDrawer
  };
}

export function typeTextAnimated(
  text: string,
  onChar: (typed: string) => void,
  onDone: () => void,
  interval = 80
): void {
  let i = 0;
  function step(): void {
    if (i <= text.length) {
      onChar(text.slice(0, i));
      playKeystrokeSound();
      i++;
      if (i <= text.length) {
        activeTimerId = window.setTimeout(step, interval);
      } else {
        onDone();
      }
    } else {
      onDone();
    }
  }
  step();
}

export function startCountdown(
  totalMs: number,
  onTick: (remainingMs: number) => void,
  onComplete: () => void
): void {
  cancelAllTimers();
  const start = performance.now();
  function tick(): void {
    const elapsed = performance.now() - start;
    const remaining = totalMs - elapsed;
    if (remaining <= 0) {
      onTick(0);
      onComplete();
      return;
    }
    onTick(remaining);
    activeRafId = requestAnimationFrame(tick);
  }
  tick();
}

export type { WordCategory };
