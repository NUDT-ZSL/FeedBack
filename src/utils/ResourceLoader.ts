import { Scene } from 'phaser';

export interface LoadedResources {
  textures: string[];
  audio: string[];
}

export class ResourceLoader {
  private scene: Scene;
  private loaded: boolean = false;
  private resources: LoadedResources = { textures: [], audio: [] };

  constructor(scene: Scene) {
    this.scene = scene;
  }

  async loadResources(): Promise<LoadedResources> {
    return new Promise((resolve) => {
      this.registerProceduralTextures();
      this.registerAudioPlaceholders();

      this.scene.load.on('complete', () => {
        this.loaded = true;
        resolve(this.resources);
      });

      if (this.scene.load.isLoading()) {
        this.scene.load.start();
      } else {
        this.loaded = true;
        resolve(this.resources);
      }
    });
  }

  private registerProceduralTextures(): void {
    const g = this.scene.add.graphics();
    g.setVisible(false);

    this.createForestBackground(g);
    this.createPlayerTexture(g);
    this.createEnemyBulletTexture(g);
    this.createParticleTextures();
    this.createUITextures(g);

    g.destroy();
  }

  private createForestBackground(g: Phaser.GameObjects.Graphics): void {
    g.clear();
    const w = 1024;
    const h = 768;
    g.fillGradientStyle(0x1a2a1a, 0x1a2a1a, 0x0f1a0f, 0x0f1a0f, 1);
    g.fillRect(0, 0, w, h);
    g.generateTexture('forest_bg', w, h);
  }

  private createPlayerTexture(g: Phaser.GameObjects.Graphics): void {
    g.clear();
    g.lineStyle(3, 0x2a4a2a, 1);
    g.fillStyle(0x4a7a4a, 1);
    g.fillTriangle(0, -16, 14, 12, -14, 12);
    g.strokeTriangle(0, -16, 14, 12, -14, 12);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(0, -4, 4);
    g.fillStyle(0x1a2a1a, 1);
    g.fillCircle(0, -4, 2);
    g.generateTexture('player', 32, 32);

    g.clear();
    g.fillStyle(0xe67300, 1);
    g.fillCircle(8, 8, 5);
    g.generateTexture('player_indicator', 16, 16);
  }

  private createEnemyBulletTexture(g: Phaser.GameObjects.Graphics): void {
    g.clear();
    g.fillStyle(0xffd700, 1);
    g.fillCircle(4, 4, 4);
    g.lineStyle(1, 0xff6b35, 1);
    g.strokeCircle(4, 4, 5);
    g.generateTexture('enemy_bullet', 10, 10);

    g.clear();
    g.fillStyle(0x00ffff, 1);
    g.fillCircle(6, 6, 6);
    g.generateTexture('attack_effect', 12, 12);
  }

  private createParticleTextures(): void {
    const pg = this.scene.add.graphics();
    pg.setVisible(false);
    const data: [string, number, number][] = [
      ['particle_orange', 0xff6b35, 4],
      ['particle_yellow', 0xffd93d, 3],
      ['particle_white', 0xffffff, 2],
      ['particle_red', 0xff0000, 6],
      ['particle_green', 0x00ff88, 5],
      ['particle_blue', 0x4682B4, 3]
    ];
    for (const [name, color, size] of data) {
      pg.clear();
      pg.fillStyle(color, 1);
      pg.fillCircle(size, size, size);
      pg.generateTexture(name, size * 2, size * 2);
      this.resources.textures.push(name);
    }
    pg.destroy();
    this.resources.textures.push('forest_bg', 'player', 'player_indicator', 'enemy_bullet', 'attack_effect');
  }

  private createUITextures(g: Phaser.GameObjects.Graphics): void {
    g.clear();
    g.fillStyle(0x1a2a1a, 0.85);
    g.fillRoundedRect(0, 0, 200, 30, 8);
    g.lineStyle(2, 0x3c5a3c, 1);
    g.strokeRoundedRect(0, 0, 200, 30, 8);
    g.generateTexture('ui_panel', 200, 30);
    this.resources.textures.push('ui_panel');
  }

  private registerAudioPlaceholders(): void {
    const audioKeys = [
      'sfx_hit',
      'sfx_explosion',
      'sfx_death',
      'sfx_attack',
      'sfx_levelup',
      'bgm_forest'
    ];
    this.resources.audio.push(...audioKeys);
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  getResources(): LoadedResources {
    return { ...this.resources, textures: [...this.resources.textures], audio: [...this.resources.audio] };
  }

  hasTexture(key: string): boolean {
    return this.scene.textures.exists(key);
  }

  hasAudio(key: string): boolean {
    return this.resources.audio.includes(key);
  }
}
