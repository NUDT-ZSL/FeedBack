import { Vector2 } from './ball';

interface Button {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  visible: boolean;
  hovered: boolean;
  onClick: () => void;
}

export class UI {
  private canvasWidth: number;
  private canvasHeight: number;
  private powerBarValue: number;
  private powerBarTarget: number;
  private isCharging: boolean;
  private strokeCount: number;
  private maxStrokes: number;
  private aimDirection: Vector2 | null;
  private ballPosition: Vector2 | null;

  public resetButton: Button;
  public nextLevelButton: Button;

  private showWinMessage: boolean;
  private winMessageAlpha: number;
  private showFailMessage: boolean;
  private failMessageAlpha: number;

  constructor(width: number, height: number) {
    this.canvasWidth = width;
    this.canvasHeight = height;
    this.powerBarValue = 0;
    this.powerBarTarget = 0;
    this.isCharging = false;
    this.strokeCount = 0;
    this.maxStrokes = 10;
    this.aimDirection = null;
    this.ballPosition = null;
    this.showWinMessage = false;
    this.winMessageAlpha = 0;
    this.showFailMessage = false;
    this.failMessageAlpha = 0;

    this.resetButton = {
      x: 20,
      y: height - 80,
      width: 100,
      height: 40,
      text: '重置',
      visible: true,
      hovered: false,
      onClick: () => {}
    };

    this.nextLevelButton = {
      x: width / 2 - 60,
      y: height / 2 + 60,
      width: 120,
      height: 45,
      text: '下一关',
      visible: false,
      hovered: false,
      onClick: () => {}
    };
  }

  setStrokeCount(count: number): void {
    this.strokeCount = count;
  }

  setCharging(charging: boolean): void {
    this.isCharging = charging;
    if (!charging) {
      this.powerBarTarget = 0;
    }
  }

  setPower(power: number): void {
    this.powerBarTarget = Math.max(0, Math.min(1, power));
  }

  setAimDirection(direction: Vector2 | null, ballPos: Vector2 | null): void {
    this.aimDirection = direction;
    this.ballPosition = ballPos;
  }

  showWin(show: boolean): void {
    this.showWinMessage = show;
    if (!show) this.winMessageAlpha = 0;
  }

  showFail(show: boolean): void {
    this.showFailMessage = show;
    if (!show) this.failMessageAlpha = 0;
  }

  update(deltaTime: number): void {
    const powerSmooth = 0.2;
    this.powerBarValue += (this.powerBarTarget - this.powerBarValue) * powerSmooth;

    if (this.isCharging && this.powerBarValue < this.powerBarTarget * 0.9) {
      this.powerBarValue += (this.powerBarTarget - this.powerBarValue) * 0.5;
    }

    if (!this.isCharging && this.powerBarValue > 0.01) {
      this.powerBarValue *= 0.85;
    }

    if (this.showWinMessage && this.winMessageAlpha < 1) {
      this.winMessageAlpha = Math.min(1, this.winMessageAlpha + deltaTime * 3);
    }

    if (this.showFailMessage && this.failMessageAlpha < 1) {
      this.failMessageAlpha = Math.min(1, this.failMessageAlpha + deltaTime * 3);
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    this.renderScoreboard(ctx);
    this.renderAimLine(ctx);
    this.renderPowerBar(ctx);
    this.renderButton(ctx, this.resetButton);

    if (this.nextLevelButton.visible) {
      this.renderButton(ctx, this.nextLevelButton);
    }

    if (this.showWinMessage) {
      this.renderWinMessage(ctx);
    }

    if (this.showFailMessage) {
      this.renderFailMessage(ctx);
    }
  }

  private renderScoreboard(ctx: CanvasRenderingContext2D): void {
    const x = 20;
    const y = 20;
    const width = 140;
    const height = 60;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 10);
    ctx.fill();

    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('击球次数', x + 15, y + 10);

    const strokeColor = this.strokeCount >= this.maxStrokes ? '#FF4444' : '#333';
    ctx.fillStyle = strokeColor;
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${this.strokeCount} / ${this.maxStrokes}`, x + width - 15, y + 28);
  }

  private renderAimLine(ctx: CanvasRenderingContext2D): void {
    if (!this.aimDirection || !this.ballPosition) return;

    const length = 100 + this.powerBarValue * 150;
    const endX = this.ballPosition.x + this.aimDirection.x * length;
    const endY = this.ballPosition.y + this.aimDirection.y * length;

    ctx.save();
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 + this.powerBarValue * 0.5})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.ballPosition.x, this.ballPosition.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + this.powerBarValue * 0.5})`;
    ctx.beginPath();
    ctx.arc(endX, endY, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private renderPowerBar(ctx: CanvasRenderingContext2D): void {
    const barX = this.canvasWidth / 2 - 200;
    const barY = this.canvasHeight - 50;
    const barWidth = 400;
    const barHeight = 20;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.roundRect(barX + 2, barY + 2, barWidth, barHeight, 10);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barWidth, barHeight, 10);
    ctx.fill();

    const fillWidth = barWidth * this.powerBarValue;
    if (fillWidth > 0) {
      const gradient = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);
      gradient.addColorStop(0, '#4CAF50');
      gradient.addColorStop(0.5, '#FFC107');
      gradient.addColorStop(1, '#F44336');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(barX, barY, fillWidth, barHeight, 10);
      ctx.fill();
    }

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(barX, barY, barWidth, barHeight, 10);
    ctx.stroke();

    ctx.fillStyle = '#333';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('力度', this.canvasWidth / 2, barY + barHeight / 2);

    if (this.powerBarValue > 0.8) {
      ctx.fillStyle = '#F44336';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText('⚠ 最大力度', this.canvasWidth / 2, barY - 15);
    }
  }

  private renderButton(ctx: CanvasRenderingContext2D, button: Button): void {
    if (!button.visible) return;

    ctx.save();

    const scale = button.hovered ? 1.05 : 1;
    const centerX = button.x + button.width / 2;
    const centerY = button.y + button.height / 2;

    ctx.translate(centerX, centerY);
    ctx.scale(scale, scale);
    ctx.translate(-centerX, -centerY);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.roundRect(button.x + 2, button.y + 2, button.width, button.height, 8);
    ctx.fill();

    const gradient = ctx.createLinearGradient(button.x, button.y, button.x, button.y + button.height);
    gradient.addColorStop(0, button.hovered ? '#66BB6A' : '#4CAF50');
    gradient.addColorStop(1, button.hovered ? '#388E3C' : '#388E3C');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(button.x, button.y, button.width, button.height, 8);
    ctx.fill();

    ctx.strokeStyle = button.hovered ? '#2E7D32' : '#2E7D32';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(button.text, centerX, centerY);

    ctx.restore();
  }

  private renderWinMessage(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = this.winMessageAlpha;

    const centerX = this.canvasWidth / 2;
    const centerY = this.canvasHeight / 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

    const scale = 1 + Math.sin(Date.now() / 200) * 0.05;
    ctx.translate(centerX, centerY);
    ctx.scale(scale, scale);
    ctx.translate(-centerX, -centerY);

    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#FFA500';
    ctx.shadowBlur = 20;
    ctx.fillText('进洞！', centerX, centerY - 40);

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(`总杆数：${this.strokeCount} 杆`, centerX, centerY + 10);

    ctx.restore();
  }

  private renderFailMessage(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = this.failMessageAlpha;

    const centerX = this.canvasWidth / 2;
    const centerY = this.canvasHeight / 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

    ctx.fillStyle = '#FF4444';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#FF0000';
    ctx.shadowBlur = 20;
    ctx.fillText('超杆数！', centerX, centerY - 20);

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px sans-serif';
    ctx.fillText('点击重置按钮重新开始', centerX, centerY + 30);

    ctx.restore();
  }

  checkButtonClick(x: number, y: number): boolean {
    const buttons = [this.resetButton, this.nextLevelButton];
    for (const button of buttons) {
      if (!button.visible) continue;
      if (
        x >= button.x &&
        x <= button.x + button.width &&
        y >= button.y &&
        y <= button.y + button.height
      ) {
        button.onClick();
        return true;
      }
    }
    return false;
  }

  checkButtonHover(x: number, y: number): void {
    const buttons = [this.resetButton, this.nextLevelButton];
    for (const button of buttons) {
      if (!button.visible) {
        button.hovered = false;
        continue;
      }
      button.hovered =
        x >= button.x &&
        x <= button.x + button.width &&
        y >= button.y &&
        y <= button.y + button.height;
    }
  }

  resize(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;

    this.resetButton.y = height - 80;
    this.nextLevelButton.x = width / 2 - 60;
    this.nextLevelButton.y = height / 2 + 60;
  }
}
