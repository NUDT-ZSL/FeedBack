import type { Player } from './player';

export type UpgradeType = 'shield' | 'fuel';

export class UIManager {
  private startScreen: HTMLElement;
  private gameOverScreen: HTMLElement;
  private upgradePanel: HTMLElement;
  private startBtn: HTMLElement;
  private restartBtn: HTMLElement;
  private upgradeShieldBtn: HTMLButtonElement;
  private upgradeFuelBtn: HTMLButtonElement;
  private finalScoreValue: HTMLElement;
  private onStartCallback: (() => void) | null = null;
  private onRestartCallback: (() => void) | null = null;
  private onUpgradeCallback: ((type: UpgradeType) => void) | null = null;
  private upgradeShown = false;

  constructor() {
    this.startScreen = document.getElementById('start-screen')!;
    this.gameOverScreen = document.getElementById('game-over-screen')!;
    this.upgradePanel = document.getElementById('upgrade-panel')!;
    this.startBtn = document.getElementById('start-btn')!;
    this.restartBtn = document.getElementById('restart-btn')!;
    this.upgradeShieldBtn = document.getElementById('upgrade-shield') as HTMLButtonElement;
    this.upgradeFuelBtn = document.getElementById('upgrade-fuel') as HTMLButtonElement;
    this.finalScoreValue = document.getElementById('final-score-value')!;

    this.startBtn.addEventListener('click', () => {
      this.onStartCallback?.();
    });

    this.restartBtn.addEventListener('click', () => {
      this.onRestartCallback?.();
    });

    this.upgradeShieldBtn.addEventListener('click', () => {
      this.onUpgradeCallback?.('shield');
    });

    this.upgradeFuelBtn.addEventListener('click', () => {
      this.onUpgradeCallback?.('fuel');
    });
  }

  onStart(callback: () => void): void {
    this.onStartCallback = callback;
  }

  onRestart(callback: () => void): void {
    this.onRestartCallback = callback;
  }

  onUpgrade(callback: (type: UpgradeType) => void): void {
    this.onUpgradeCallback = callback;
  }

  hideStartScreen(): void {
    this.startScreen.classList.add('hidden');
  }

  showStartScreen(): void {
    this.startScreen.classList.remove('hidden');
  }

  showGameOver(score: number): void {
    this.finalScoreValue.textContent = String(score);
    this.gameOverScreen.classList.remove('hidden');
  }

  hideGameOver(): void {
    this.gameOverScreen.classList.add('hidden');
  }

  showUpgradePanel(): void {
    if (this.upgradeShown) return;
    this.upgradePanel.classList.add('active');
    this.upgradeShown = true;
  }

  hideUpgradePanel(): void {
    this.upgradePanel.classList.remove('active');
    this.upgradeShown = false;
  }

  updateUpgradeButtons(player: Player): void {
    this.upgradeShieldBtn.disabled = player.score < 50;
    this.upgradeFuelBtn.disabled = player.score < 30;
  }

  isUpgradePanelActive(): boolean {
    return this.upgradeShown;
  }

  reset(): void {
    this.hideGameOver();
    this.hideUpgradePanel();
    this.upgradeShown = false;
  }
}
