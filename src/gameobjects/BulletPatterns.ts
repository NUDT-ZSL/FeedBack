import Phaser from 'phaser';

export interface EnemyBulletConfig {
  x: number;
  y: number;
  color: number;
  speed: number;
  scene: Phaser.Scene;
  pool: Phaser.Physics.Arcade.Group;
}

export function createFanPattern(config: EnemyBulletConfig): Phaser.Physics.Arcade.Sprite[] {
  const { x, y, color, speed, scene, pool } = config;
  const bullets: Phaser.Physics.Arcade.Sprite[] = [];
  const count = 7;
  const spreadAngle = Math.PI / 3;
  const startAngle = Math.PI / 2 - spreadAngle / 2;
  const angleStep = spreadAngle / (count - 1);

  for (let i = 0; i < count; i++) {
    const angle = startAngle + angleStep * i;
    const bullet = getBulletFromPool(scene, pool, x, y, color);
    if (bullet) {
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      bullet.setVelocity(vx, vy);
      bullet.setActive(true);
      bullet.setVisible(true);
      bullets.push(bullet);
    }
  }
  return bullets;
}

export function createSpiralPattern(config: EnemyBulletConfig, timeOffset: number = 0): Phaser.Physics.Arcade.Sprite[] {
  const { x, y, color, speed, scene, pool } = config;
  const bullets: Phaser.Physics.Arcade.Sprite[] = [];
  const count = 12;
  const angleStep = (Math.PI * 2) / count;

  for (let i = 0; i < count; i++) {
    const angle = angleStep * i + timeOffset;
    const bullet = getBulletFromPool(scene, pool, x, y, color);
    if (bullet) {
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      bullet.setVelocity(vx, vy);
      bullet.setActive(true);
      bullet.setVisible(true);
      bullets.push(bullet);
    }
  }
  return bullets;
}

export function createGridPattern(config: EnemyBulletConfig): Phaser.Physics.Arcade.Sprite[] {
  const { x, y, color, speed, scene, pool } = config;
  const bullets: Phaser.Physics.Arcade.Sprite[] = [];
  const cols = 5;
  const spacing = 18;

  for (let i = 0; i < cols; i++) {
    const offsetX = (i - Math.floor(cols / 2)) * spacing;
    const bullet = getBulletFromPool(scene, pool, x + offsetX, y, color);
    if (bullet) {
      bullet.setVelocity(0, speed);
      bullet.setActive(true);
      bullet.setVisible(true);
      bullets.push(bullet);
    }
  }
  return bullets;
}

function getBulletFromPool(
  scene: Phaser.Scene,
  pool: Phaser.Physics.Arcade.Group,
  x: number,
  y: number,
  color: number
): Phaser.Physics.Arcade.Sprite | null {
  let bullet = pool.getFirstDead(false) as Phaser.Physics.Arcade.Sprite | null;

  if (!bullet) {
    bullet = scene.physics.add.sprite(x, y, '');
    bullet.setCircle(3);
    pool.add(bullet);
  } else {
    bullet.enableBody(true, x, y, true, true);
  }

  bullet.setTexture(createCircleBulletTexture(scene, color));
  bullet.body!.reset(x, y);
  bullet.body!.setCircle(3);
  bullet.setData('isEnemyBullet', true);

  return bullet;
}

let bulletTextureCache: Record<string, string> = {};

function createCircleBulletTexture(scene: Phaser.Scene, color: number): string {
  const key = `enemy_bullet_${color}`;
  if (bulletTextureCache[key]) {
    return bulletTextureCache[key];
  }

  if (scene.textures.exists(key)) {
    bulletTextureCache[key] = key;
    return key;
  }

  const g = scene.add.graphics();
  g.fillStyle(color, 1);
  g.fillCircle(3, 3, 3);
  g.fillStyle(0xffffff, 0.6);
  g.fillCircle(3, 3, 1.5);
  g.generateTexture(key, 6, 6);
  g.destroy();

  bulletTextureCache[key] = key;
  return key;
}

export function clearBulletTextureCache(): void {
  bulletTextureCache = {};
}

export type BulletPatternType = 'fan' | 'spiral' | 'grid';

export function createRandomPattern(
  config: EnemyBulletConfig,
  timeOffset: number = 0
): Phaser.Physics.Arcade.Sprite[] {
  const patterns: BulletPatternType[] = ['fan', 'spiral', 'grid'];
  const chosen = patterns[Math.floor(Math.random() * patterns.length)];

  switch (chosen) {
    case 'fan':
      return createFanPattern(config);
    case 'spiral':
      return createSpiralPattern(config, timeOffset);
    case 'grid':
      return createGridPattern(config);
    default:
      return createFanPattern(config);
  }
}
