import Phaser from 'phaser';

export class Boot extends Phaser.Scene {
  constructor() {
    super({ key: 'Boot' });
  }

  preload(): void {
    this.createPlayerTexture();
    this.createEnemyTextures();
    this.createParticleTextures();
    this.createBulletTexture();
    this.createHeartTexture();
    this.createNukeTexture();
  }

  createPlayerTexture(): void {
    const g = this.add.graphics();
    g.clear();
    g.fillStyle(0x4fc3f7, 1);
    g.fillRect(7, 2, 2, 4);
    g.fillRect(6, 6, 4, 4);
    g.fillRect(4, 10, 8, 2);
    g.fillStyle(0x29b6f6, 1);
    g.fillRect(2, 8, 2, 4);
    g.fillRect(12, 8, 2, 4);
    g.fillStyle(0x0288d1, 1);
    g.fillRect(0, 10, 2, 4);
    g.fillRect(14, 10, 2, 4);
    g.fillStyle(0xffffff, 1);
    g.fillRect(7, 6, 2, 2);
    g.generateTexture('player_ship', 16, 16);
    g.destroy();

    const g2 = this.add.graphics();
    g2.clear();
    g2.fillStyle(0x4fc3f7, 1);
    g2.fillRect(5, 2, 2, 4);
    g2.fillRect(4, 6, 4, 4);
    g2.fillRect(2, 10, 8, 2);
    g2.fillStyle(0x29b6f6, 1);
    g2.fillRect(0, 8, 2, 4);
    g2.fillRect(10, 8, 2, 4);
    g2.fillStyle(0x0288d1, 1);
    g2.fillRect(0, 10, 2, 4);
    g2.fillRect(12, 10, 2, 4);
    g2.fillStyle(0xffffff, 1);
    g2.fillRect(5, 6, 2, 2);
    g2.generateTexture('player_left', 16, 16);
    g2.destroy();

    const g3 = this.add.graphics();
    g3.clear();
    g3.fillStyle(0x4fc3f7, 1);
    g3.fillRect(9, 2, 2, 4);
    g3.fillRect(8, 6, 4, 4);
    g3.fillRect(6, 10, 8, 2);
    g3.fillStyle(0x29b6f6, 1);
    g3.fillRect(4, 8, 2, 4);
    g3.fillRect(14, 8, 2, 4);
    g3.fillStyle(0x0288d1, 1);
    g3.fillRect(2, 10, 2, 4);
    g3.fillRect(14, 10, 2, 4);
    g3.fillStyle(0xffffff, 1);
    g3.fillRect(9, 6, 2, 2);
    g3.generateTexture('player_right', 16, 16);
    g3.destroy();
  }

  createEnemyTextures(): void {
    const g = this.add.graphics();
    g.fillStyle(0xff5252, 1);
    g.fillRect(3, 2, 10, 2);
    g.fillRect(1, 4, 14, 4);
    g.fillRect(3, 8, 10, 4);
    g.fillRect(5, 12, 6, 2);
    g.fillStyle(0xffffff, 1);
    g.fillRect(5, 6, 2, 2);
    g.fillRect(9, 6, 2, 2);
    g.fillStyle(0x212121, 1);
    g.fillRect(6, 7, 1, 1);
    g.fillRect(10, 7, 1, 1);
    g.generateTexture('enemy_normal', 16, 16);
    g.destroy();

    const g2 = this.add.graphics();
    g2.fillStyle(0x90a4ae, 1);
    g2.fillRect(2, 0, 20, 4);
    g2.fillRect(0, 4, 24, 6);
    g2.fillRect(2, 10, 20, 6);
    g2.fillRect(4, 16, 16, 4);
    g2.fillStyle(0x607d8b, 1);
    g2.fillRect(0, 4, 24, 2);
    g2.fillRect(4, 10, 16, 2);
    g2.fillStyle(0xff1744, 1);
    g2.fillRect(6, 7, 4, 3);
    g2.fillRect(14, 7, 4, 3);
    g2.generateTexture('enemy_armor', 24, 20);
    g2.destroy();
  }

  createParticleTextures(): void {
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 2, 2);
    g.generateTexture('particle_white', 2, 2);
    g.destroy();

    const g2 = this.add.graphics();
    g2.fillStyle(0x4fc3f7, 1);
    g2.fillRect(0, 0, 3, 3);
    g2.generateTexture('particle_blue', 3, 3);
    g2.destroy();

    const g3 = this.add.graphics();
    g3.fillStyle(0xff6e40, 1);
    g3.fillRect(0, 0, 2, 2);
    g3.generateTexture('particle_hit', 2, 2);
    g3.destroy();

    const g4 = this.add.graphics();
    g4.fillStyle(0xff5252, 1);
    g4.fillRect(0, 0, 2, 2);
    g4.generateTexture('particle_enemy', 2, 2);
    g4.destroy();
  }

  createBulletTexture(): void {
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 3, 8);
    g.fillStyle(0x4fc3f7, 1);
    g.fillRect(0, 0, 3, 2);
    g.generateTexture('player_bullet', 3, 8);
    g.destroy();
  }

  createHeartTexture(): void {
    const g = this.add.graphics();
    g.fillStyle(0xff1744, 1);
    g.fillRect(1, 0, 2, 1);
    g.fillRect(5, 0, 2, 1);
    g.fillRect(0, 1, 4, 2);
    g.fillRect(4, 1, 4, 2);
    g.fillRect(0, 3, 8, 2);
    g.fillRect(1, 5, 6, 1);
    g.fillRect(2, 6, 4, 1);
    g.fillRect(3, 7, 2, 1);
    g.fillStyle(0xff8a80, 1);
    g.fillRect(1, 1, 2, 1);
    g.generateTexture('heart_icon', 8, 8);
    g.destroy();
  }

  createNukeTexture(): void {
    const g = this.add.graphics();
    g.fillStyle(0xffeb3b, 1);
    g.fillCircle(10, 10, 8);
    g.fillStyle(0xff9800, 1);
    g.fillCircle(10, 10, 5);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(10, 10, 2);
    g.fillStyle(0x212121, 1);
    g.fillRect(9, 2, 2, 4);
    g.generateTexture('nuke_icon', 20, 20);
    g.destroy();
  }

  create(): void {
    this.scene.start('Game');
  }
}
