// ============================================================
// unitManager.ts - 单位管理器
// 依赖：config.ts
// 被依赖：mainScene.ts
// 数据流向：接收mainScene调用 -> 处理单位逻辑/动画 -> 输出结果到mainScene
// ============================================================

import Phaser from 'phaser';
import {
  HEX_SIZE, HEX_GAP, BOARD_COLS, BOARD_ROWS,
  UnitData, createUnitData, randomRace, Race,
  COLORS, MAX_UNITS_PER_PLAYER
} from './config';

export interface HexCoord {
  col: number;
  row: number;
}

export interface Unit {
  id: string;
  owner: 'red' | 'blue';
  data: UnitData;
  hex: HexCoord;
  sprite: Phaser.GameObjects.Container;
  hasMoved: boolean;
  hasAttacked: boolean;
}

export interface MoveResult {
  from: HexCoord;
  to: HexCoord;
  path: HexCoord[];
}

export interface AttackResult {
  attacker: Unit;
  target: Unit;
  damage: number;
  targetKilled: boolean;
}

// odd-r 偏移坐标 -> 像素坐标
export function hexToPixel(hex: HexCoord): { x: number; y: number } {
  const w = Math.sqrt(3) * (HEX_SIZE + HEX_GAP / 2);
  const h = 2 * (HEX_SIZE + HEX_GAP / 2);
  const x = w * (hex.col + 0.5 * (hex.row & 1));
  const y = h * 0.75 * hex.row;
  return { x: x + HEX_SIZE + 40, y: y + HEX_SIZE + 40 };
}

// 像素坐标 -> odd-r 偏移坐标
export function pixelToHex(px: number, py: number): HexCoord | null {
  const w = Math.sqrt(3) * (HEX_SIZE + HEX_GAP / 2);
  const h = 2 * (HEX_SIZE + HEX_GAP / 2);
  const ax = px - HEX_SIZE - 40;
  const ay = py - HEX_SIZE - 40;
  const rowF = ay / (h * 0.75);
  const row = Math.round(rowF);
  const colF = ax / w - 0.5 * (row & 1);
  const col = Math.round(colF);
  if (col < 0 || col >= BOARD_COLS || row < 0 || row >= BOARD_ROWS) return null;
  return { col, row };
}

// odd-r 偏移坐标的六个邻居
export function hexNeighbors(hex: HexCoord): HexCoord[] {
  const evenRowOffsets: HexCoord[] = [
    { col: 1, row: 0 }, { col: 0, row: -1 }, { col: -1, row: -1 },
    { col: -1, row: 0 }, { col: -1, row: 1 }, { col: 0, row: 1 }
  ];
  const oddRowOffsets: HexCoord[] = [
    { col: 1, row: 0 }, { col: 1, row: -1 }, { col: 0, row: -1 },
    { col: -1, row: 0 }, { col: 0, row: 1 }, { col: 1, row: 1 }
  ];
  const offsets = (hex.row & 1) ? oddRowOffsets : evenRowOffsets;
  return offsets.map(o => ({ col: hex.col + o.col, row: hex.row + o.row }))
    .filter(h => h.col >= 0 && h.col < BOARD_COLS && h.row >= 0 && h.row < BOARD_ROWS);
}

export function hexDistance(a: HexCoord, b: HexCoord): number {
  const ac = offsetToCube(a);
  const bc = offsetToCube(b);
  return (Math.abs(ac.x - bc.x) + Math.abs(ac.y - bc.y) + Math.abs(ac.z - bc.z)) / 2;
}

interface CubeCoord { x: number; y: number; z: number; }
function offsetToCube(hex: HexCoord): CubeCoord {
  const x = hex.col - (hex.row - (hex.row & 1)) / 2;
  const z = hex.row;
  const y = -x - z;
  return { x, y, z };
}

export class UnitManager {
  private scene: Phaser.Scene;
  public units: Map<string, Unit> = new Map();
  private nextId = 0;
  public onUnitDestroyed?: (unit: Unit) => void;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  public hasUnitAt(hex: HexCoord): boolean {
    return this.getUnitAt(hex) !== null;
  }

  public getUnitAt(hex: HexCoord): Unit | null {
    for (const u of this.units.values()) {
      if (u.hex.col === hex.col && u.hex.row === hex.row) return u;
    }
    return null;
  }

  public getUnitsOfPlayer(player: 'red' | 'blue'): Unit[] {
    return [...this.units.values()].filter(u => u.owner === player);
  }

  public countUnitsOfPlayer(player: 'red' | 'blue'): number {
    return this.getUnitsOfPlayer(player).length;
  }

  public canSummon(player: 'red' | 'blue'): boolean {
    return this.countUnitsOfPlayer(player) < MAX_UNITS_PER_PLAYER;
  }

  public createUnit(
    owner: 'red' | 'blue',
    hex: HexCoord,
    race?: Race
  ): Unit | null {
    if (this.hasUnitAt(hex)) return null;
    if (!this.canSummon(owner)) return null;
    const id = `unit_${this.nextId++}`;
    const data = createUnitData(race ?? randomRace());
    const sprite = this.createUnitSprite(owner, data);
    const pixel = hexToPixel(hex);
    sprite.setPosition(pixel.x, pixel.y);
    const unit: Unit = { id, owner, data, hex, sprite, hasMoved: false, hasAttacked: false };
    this.units.set(id, unit);
    this.playSummonEffect(sprite);
    return unit;
  }

  private createUnitSprite(owner: 'red' | 'blue', data: UnitData): Phaser.GameObjects.Container {
    const container = this.scene.add.container(0, 0);
    const color = owner === 'red' ? COLORS.playerRed : COLORS.playerBlue;
    const bgCircle = this.scene.add.circle(0, 0, 14, 0x1a1a2a, 1);
    const borderCircle = this.scene.add.circle(0, 0, 14, color, 1);
    borderCircle.setStrokeStyle(3, color, 1);
    borderCircle.setFillStyle(0x1a1a2a, 1);
    const initial = this.scene.add.text(0, 0, data.initial, {
      fontFamily: 'Arial Black, sans-serif',
      fontSize: '14px',
      color: '#ffffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);
    container.add([bgCircle, borderCircle, initial]);
    container.setSize(28, 28);
    container.setInteractive(new Phaser.Geom.Circle(0, 0, 14), Phaser.Geom.Circle.Contains);
    return container;
  }

  private playSummonEffect(container: Phaser.GameObjects.Container) {
    container.setAlpha(0).setScale(0.3);
    this.scene.tweens.add({
      targets: container,
      alpha: 1,
      scale: 1,
      duration: 300,
      ease: 'Back.out'
    });
    const pos = { x: container.x, y: container.y };
    this.createFlashAt(pos.x, pos.y, 15);
  }

  private createFlashAt(x: number, y: number, radius: number) {
    const flash = this.scene.add.circle(x, y, radius, 0xffffff, 0.8);
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 2.5,
      duration: 300,
      ease: 'Cubic.out',
      onComplete: () => flash.destroy()
    });
  }

  // Dijkstra计算可移动范围
  public getMoveRange(unit: Unit): HexCoord[] {
    if (unit.hasMoved) return [];
    const startKey = `${unit.hex.col},${unit.hex.row}`;
    const dist: Map<string, number> = new Map();
    dist.set(startKey, 0);
    const queue: { hex: HexCoord; cost: number }[] = [{ hex: unit.hex, cost: 0 }];
    const reachable: HexCoord[] = [];
    while (queue.length > 0) {
      queue.sort((a, b) => a.cost - b.cost);
      const cur = queue.shift()!;
      const curKey = `${cur.hex.col},${cur.hex.row}`;
      if (cur.cost > (dist.get(curKey) ?? Infinity)) continue;
      if (cur.cost > 0) reachable.push(cur.hex);
      if (cur.cost >= unit.data.move) continue;
      for (const n of hexNeighbors(cur.hex)) {
        const nKey = `${n.col},${n.row}`;
        if (this.hasUnitAt(n)) continue;
        const nd = cur.cost + 1;
        if (nd < (dist.get(nKey) ?? Infinity)) {
          dist.set(nKey, nd);
          queue.push({ hex: n, cost: nd });
        }
      }
    }
    return reachable;
  }

  public getAttackRange(unit: Unit): HexCoord[] {
    if (unit.hasAttacked) return [];
    const range = unit.data.attackRange;
    const result: HexCoord[] = [];
    for (let c = 0; c < BOARD_COLS; c++) {
      for (let r = 0; r < BOARD_ROWS; r++) {
        const target: HexCoord = { col: c, row: r };
        const targetUnit = this.getUnitAt(target);
        if (!targetUnit) continue;
        if (targetUnit.owner === unit.owner) continue;
        if (hexDistance(unit.hex, target) <= range) {
          result.push(target);
        }
      }
    }
    return result;
  }

  public moveUnit(unit: Unit, to: HexCoord): Promise<MoveResult> {
    return new Promise((resolve) => {
      const from = { ...unit.hex };
      const pixel = hexToPixel(to);
      this.scene.tweens.add({
        targets: unit.sprite,
        x: pixel.x,
        y: pixel.y,
        duration: 250,
        ease: 'Sine.out',
        onComplete: () => {
          unit.hex = to;
          unit.hasMoved = true;
          resolve({ from, to, path: [from, to] });
        }
      });
    });
  }

  public attackUnit(attacker: Unit, target: Unit): Promise<AttackResult> {
    return new Promise((resolve) => {
      this.scene.sound.play('attack', { volume: 0.2 });
      const origX = attacker.sprite.x;
      const origY = attacker.sprite.y;
      const dx = target.sprite.x - origX;
      const dy = target.sprite.y - origY;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const moveX = origX + (dx / len) * 10;
      const moveY = origY + (dy / len) * 10;
      this.scene.tweens.add({
        targets: attacker.sprite,
        x: moveX,
        y: moveY,
        duration: 100,
        ease: 'Sine.out',
        yoyo: true,
        hold: 0,
        onComplete: () => {
          attacker.sprite.setPosition(origX, origY);
        }
      });
      this.scene.time.delayedCall(100, () => {
        // flash target white
        const flash = this.scene.add.circle(target.sprite.x, target.sprite.y, 14, 0xffffff, 0.9);
        this.scene.tweens.add({
          targets: flash,
          alpha: 0,
          duration: 100,
          ease: 'Quad.out',
          onComplete: () => flash.destroy()
        });
        const damage = attacker.data.attack;
        target.data.hp -= damage;
        attacker.hasAttacked = true;
        const killed = target.data.hp <= 0;
        if (killed) {
          this.destroyUnit(target);
        }
        resolve({ attacker, target, damage, targetKilled: killed });
      });
    });
  }

  public destroyUnit(unit: Unit) {
    // particle effect
    const x = unit.sprite.x;
    const y = unit.sprite.y;
    const color = unit.owner === 'red' ? COLORS.playerRed : COLORS.playerBlue;
    for (let i = 0; i < 15; i++) {
      const angle = (Math.PI * 2 * i) / 15 + Math.random() * 0.5;
      const speed = 30 + Math.random() * 40;
      const p = this.scene.add.circle(x, y, 3, color, 1);
      this.scene.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * speed,
        y: y + Math.sin(angle) * speed,
        alpha: 0,
        scale: 0.3,
        duration: 500,
        ease: 'Quad.out',
        onComplete: () => p.destroy()
      });
    }
    this.scene.tweens.add({
      targets: unit.sprite,
      alpha: 0,
      scale: 0.2,
      duration: 400,
      ease: 'Quad.in',
      onComplete: () => {
        unit.sprite.destroy();
        this.units.delete(unit.id);
        if (this.onUnitDestroyed) this.onUnitDestroyed(unit);
      }
    });
  }

  public resetTurn(player: 'red' | 'blue') {
    for (const u of this.units.values()) {
      if (u.owner === player) {
        u.hasMoved = false;
        u.hasAttacked = false;
      }
    }
  }

  public clearAll() {
    for (const u of this.units.values()) {
      u.sprite.destroy();
    }
    this.units.clear();
    this.nextId = 0;
  }
}
