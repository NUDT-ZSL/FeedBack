import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { pickAtom } from '../src/core/picking';
import { screenToNdc, worldToScreen } from '../src/core/projection';
import { MOLECULES } from '../src/moleculeData';
import { makeCamera, VIEWPORT } from './helpers';

const h2oAtoms = MOLECULES[0].atoms.map(a => ({ position: a.position, radius: a.radius }));

describe('射线拾取原子命中判定', () => {
  it('准星对准屏幕中心命中 H2O 的氧原子（序号 0）', () => {
    const camera = makeCamera([0, 0, 8]);
    expect(pickAtom({ x: 0, y: 0 }, camera, h2oAtoms)).toBe(0);
  });

  it('准星偏离所有原子时未命中', () => {
    const camera = makeCamera([0, 0, 8]);
    expect(pickAtom({ x: 0.95, y: 0.95 }, camera, h2oAtoms)).toBe(-1);
    expect(pickAtom({ x: -0.95, y: -0.9 }, camera, h2oAtoms)).toBe(-1);
  });

  it('投影氢原子到屏幕坐标后能命中对应序号', () => {
    const camera = makeCamera([0, 0, 8]);
    for (const index of [1, 2]) {
      const atom = MOLECULES[0].atoms[index];
      const screen = worldToScreen(new THREE.Vector3(...atom.position), camera, VIEWPORT);
      const ndc = screenToNdc(screen.x, screen.y, VIEWPORT);
      expect(pickAtom(ndc, camera, h2oAtoms)).toBe(index);
    }
  });

  it('多个原子共线时命中最近的一个', () => {
    const camera = makeCamera([0, 0, 8]);
    const atoms = [
      { position: [0, 0, 0] as [number, number, number], radius: 0.5 },
      { position: [0, 0, 2] as [number, number, number], radius: 0.5 }
    ];
    expect(pickAtom({ x: 0, y: 0 }, camera, atoms)).toBe(1);

    const reversed = [atoms[1], atoms[0]];
    expect(pickAtom({ x: 0, y: 0 }, camera, reversed)).toBe(0);
  });

  it('相机移动后命中结果跟随新视角', () => {
    const sideCamera = makeCamera([8, 0, 0], [0, 0, 0]);
    const co2Atoms = MOLECULES[1].atoms.map(a => ({ position: a.position, radius: a.radius }));
    expect(pickAtom({ x: 0, y: 0 }, sideCamera, co2Atoms)).toBe(1);
  });
});
