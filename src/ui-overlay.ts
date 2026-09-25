import type { ColorTheme, GestureType } from './audio-visualizer';

export class UIOverlay {
  private container: HTMLElement;
  private songTitle!: HTMLElement;
  private songArtist!: HTMLElement;
  private progressFill!: HTMLElement;
  private progressBar!: HTMLElement;
  private timeCurrent!: HTMLElement;
  private timeDuration!: HTMLElement;
  private volumeFill!: HTMLElement;
  private volumePercent!: HTMLElement;
  private gestureIcon!: SVGElement;
  private gestureLabel!: HTMLElement;
  private gestureStatus!: HTMLElement;
  private themesContainer!: HTMLElement;
  private playlistHint!: HTMLElement;
  private seekCallback: ((time: number) => void) | null = null;
  private isDragging = false;
  private currentDuration = 0;
  private currentThemeIndex = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.cacheElements();
    this.bindProgressEvents();
  }

  private cacheElements(): void {
    this.songTitle = this.el('song-title');
    this.songArtist = this.el('song-artist');
    this.progressFill = this.el('progress-fill');
    this.progressBar = this.el('progress-bar');
    this.timeCurrent = this.el('time-current');
    this.timeDuration = this.el('time-duration');
    this.volumeFill = this.el('volume-fill');
    this.volumePercent = this.el('volume-percent');
    this.gestureIcon = this.el('gesture-icon') as unknown as SVGElement;
    this.gestureLabel = this.el('gesture-label');
    this.gestureStatus = this.el('gesture-status');
    this.themesContainer = this.el('themes-container');
    this.playlistHint = this.el('playlist-hint');
  }

  private el(id: string): HTMLElement {
    const e = document.getElementById(id);
    if (!e) throw new Error(`Element #${id} not found`);
    return e;
  }

  private bindProgressEvents(): void {
    const onDown = (e: MouseEvent) => {
      this.isDragging = true;
      this.handleSeek(e);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
    const onMove = (e: MouseEvent) => {
      if (this.isDragging) this.handleSeek(e);
    };
    const onUp = () => {
      this.isDragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    this.progressBar.addEventListener('mousedown', onDown);
  }

  private handleSeek(e: MouseEvent): void {
    const rect = this.progressBar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = pct * this.currentDuration;
    if (this.seekCallback) this.seekCallback(time);
  }

  setSongInfo(title: string, artist: string): void {
    this.songTitle.textContent = title;
    this.songArtist.textContent = artist;
  }

  setProgress(current: number, duration: number, onSeek?: (t: number) => void): void {
    this.currentDuration = duration;
    if (!this.isDragging) {
      const pct = duration > 0 ? (current / duration) * 100 : 0;
      this.progressFill.style.width = pct + '%';
    }
    this.timeCurrent.textContent = this.formatTime(current);
    this.timeDuration.textContent = this.formatTime(duration);
    if (onSeek) this.seekCallback = onSeek;
  }

  setVolume(percent: number): void {
    const p = Math.max(0, Math.min(100, Math.round(percent * 100)));
    this.volumeFill.style.width = p + '%';
    this.volumePercent.textContent = p + '%';
  }

  setGestureIcon(gesture: GestureType): void {
    this.gestureIcon.classList.remove('bounce');
    void this.gestureIcon.offsetWidth;
    this.gestureIcon.classList.add('bounce');
    this.gestureIcon.innerHTML = this.gestureSVG(gesture);
    this.gestureLabel.textContent = this.gestureLabelText(gesture);
    setTimeout(() => this.gestureIcon.classList.remove('bounce'), 220);
  }

  setGestureActive(active: boolean): void {
    if (active) this.gestureStatus.classList.add('active');
    else this.gestureStatus.classList.remove('active');
  }

  setThemes(themes: ColorTheme[], activeIndex: number, onSelect: (i: number) => void): void {
    this.currentThemeIndex = activeIndex;
    this.themesContainer.innerHTML = '';
    themes.forEach((theme, i) => {
      const btn = document.createElement('div');
      btn.className = 'theme-btn' + (i === activeIndex ? ' active' : '');
      btn.setAttribute('data-name', theme.name);
      const low = `rgb(${theme.lowColor.join(',')})`;
      const mid = `rgb(${theme.midColor.join(',')})`;
      const high = `rgb(${theme.highColor.join(',')})`;
      btn.style.background = `conic-gradient(from 0deg, ${low}, ${mid}, ${high}, ${low})`;
      btn.addEventListener('click', () => {
        if (i === this.currentThemeIndex) return;
        this.currentThemeIndex = i;
        const nodes = this.themesContainer.querySelectorAll('.theme-btn');
        nodes.forEach(n => n.classList.remove('active'));
        btn.classList.add('active');
        onSelect(i);
        const docStyle = document.documentElement.style;
        docStyle.setProperty('--bg-top', theme.bgTop);
        docStyle.setProperty('--bg-bottom', theme.bgBottom);
        document.body.style.background = `linear-gradient(to bottom, ${theme.bgTop} 0%, ${theme.bgBottom} 100%)`;
      });
      this.themesContainer.appendChild(btn);
    });
  }

  setPlaylistHint(text: string): void {
    this.playlistHint.textContent = text;
  }

  private formatTime(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return m + ':' + (rs < 10 ? '0' : '') + rs;
  }

  private gestureLabelText(g: GestureType): string {
    switch (g) {
      case '1-finger': return '播放 / 暂停';
      case '2-finger': return '下一首';
      case '3-finger': return '音量 +';
      case '4-finger': return '音量 −';
      case '5-finger': return '5 指张开';
      case 'fist': return '静音';
      case 'none': return '等待手势';
    }
  }

  private gestureSVG(g: GestureType): string {
    const skin = '#f5d7b8';
    const line = '#2a2a3e';
    const hl = '#00ffcc';
    const w = 100, h = 100;
    const circle = (cx: number, cy: number, r: number, fill: string) =>
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${line}" stroke-width="1.5"/>`;
    const bone = (x1: number, y1: number, x2: number, y2: number, col = skin) =>
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="6" stroke-linecap="round"/>`;
    const palm = `<ellipse cx="50" cy="70" rx="20" ry="16" fill="${skin}" stroke="${line}" stroke-width="1.5"/>`;
    const joints = (pts: [number, number][], highlight = false) =>
      pts.map(([x, y]) => circle(x, y, highlight ? 4 : 3, highlight ? hl : skin)).join('');
    type FingerSpec = { tip: [number, number]; pip: [number, number]; mcp: [number, number]; extended: boolean };
    const drawFinger = (f: FingerSpec, highlight: boolean) => {
      const col = highlight && f.extended ? hl : skin;
      let tipTarget = f.extended ? f.tip : f.mcp;
      if (!f.extended) {
        const dx = f.mcp[0] + (f.tip[0] - f.mcp[0]) * 0.35;
        const dy = f.mcp[1] + (f.tip[1] - f.mcp[1]) * 0.25 - 8;
        tipTarget = [dx, dy];
      }
      return bone(f.mcp[0], f.mcp[1], f.pip[0], f.pip[1], col) +
             bone(f.pip[0], f.pip[1], tipTarget[0], tipTarget[1], col) +
             joints([f.mcp, f.pip], false) +
             (f.extended ? circle(tipTarget[0], tipTarget[1], 4, hl) : circle(tipTarget[0], tipTarget[1], 3, skin));
    };
    const fingers = (config: boolean[], hlIdx = -1) => {
      const specs: FingerSpec[] = [
        { tip: [78, 62], pip: [72, 66], mcp: [68, 72], extended: config[0] },
        { tip: [74, 30], pip: [72, 45], mcp: [70, 62], extended: config[1] },
        { tip: [58, 22], pip: [58, 40], mcp: [58, 58], extended: config[2] },
        { tip: [44, 26], pip: [44, 43], mcp: [46, 60], extended: config[3] },
        { tip: [28, 38], pip: [32, 52], mcp: [36, 64], extended: config[4] },
      ];
      return specs.map((s, i) => drawFinger(s, hlIdx === i)).join('');
    };
    const cfg = this.getFingerCfg(g);
    const hlIdx = this.highlightIndex(g);
    let body = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
    body += palm;
    body += fingers(cfg, hlIdx);
    body += '</svg>';
    return body;
  }

  private getFingerCfg(g: GestureType): boolean[] {
    switch (g) {
      case '1-finger': return [false, true, false, false, false];
      case '2-finger': return [false, true, true, false, false];
      case '3-finger': return [false, true, true, true, false];
      case '4-finger': return [false, true, true, true, true];
      case '5-finger': return [true, true, true, true, true];
      case 'fist': return [false, false, false, false, false];
      case 'none': return [false, false, false, false, false];
    }
  }

  private highlightIndex(g: GestureType): number {
    switch (g) {
      case '1-finger': return 1;
      case '2-finger': return 2;
      case '3-finger': return 3;
      case '4-finger': return 4;
      case '5-finger': return 0;
      default: return -1;
    }
  }
}
