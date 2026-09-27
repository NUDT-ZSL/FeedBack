import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { updateHUD } from '../src/hud';
import { CoralManager } from '../src/coral';
import { FishManager } from '../src/fish';

function setupHudDom(): void {
  document.body.innerHTML = `
    <div id="hud">
      <span id="fps">60</span>
      <span id="fish-count">0</span>
      <span id="coral-count">0</span>
      <span id="water-temp">25</span>
    </div>`;
}

describe('HUD 与管理器内部计数一致', () => {
  beforeEach(setupHudDom);

  it('鱼群 / 珊瑚 / FPS 显示与管理器计数一致', () => {
    const coralManager = new CoralManager(new THREE.Scene());
    const fishManager = new FishManager(
      new THREE.Scene(),
      coralManager.getClusterCenters()
    );
    updateHUD(document, {
      fps: 59.6,
      fishCount: fishManager.fishCount,
      coralCount: coralManager.coralCount,
    });
    expect(document.getElementById('fps')!.textContent).toBe('60');
    expect(document.getElementById('fish-count')!.textContent)
      .toBe(fishManager.fishCount.toString());
    expect(document.getElementById('coral-count')!.textContent)
      .toBe(coralManager.coralCount.toString());
  });

  it('切换鱼群数量与重置后 HUD 跟随管理器计数变化', () => {
    const coralManager = new CoralManager(new THREE.Scene());
    const fishManager = new FishManager(
      new THREE.Scene(),
      coralManager.getClusterCenters()
    );
    fishManager.toggleSchoolSize();
    updateHUD(document, {
      fps: 60,
      fishCount: fishManager.fishCount,
      coralCount: coralManager.coralCount,
    });
    expect(document.getElementById('fish-count')!.textContent).toBe('15');

    coralManager.reset();
    fishManager.reset(coralManager.getClusterCenters());
    updateHUD(document, {
      fps: 60,
      fishCount: fishManager.fishCount,
      coralCount: coralManager.coralCount,
    });
    expect(document.getElementById('fish-count')!.textContent).toBe('30');
    expect(document.getElementById('coral-count')!.textContent).toBe('54');
  });

  it('缺少 HUD 元素时不抛异常', () => {
    document.body.innerHTML = '';
    expect(() => updateHUD(document, { fps: 1, fishCount: 2, coralCount: 3 }))
      .not.toThrow();
  });
});
