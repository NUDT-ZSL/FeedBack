import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  ViewerCore,
  DEFAULT_CAMERA_POSITION,
  DEFAULT_CAMERA_TARGET
} from '../src/core/viewerCore';
import { worldToScreen, screenToNdc, labelAnchor } from '../src/core/projection';
import { MOLECULES } from '../src/moleculeData';
import { makeCamera, VIEWPORT } from './helpers';

const [H2O, CO2, C6H6] = MOLECULES;

class CameraRig {
  position = new THREE.Vector3(...DEFAULT_CAMERA_POSITION);
  target = new THREE.Vector3(...DEFAULT_CAMERA_TARGET);

  reset(): void {
    this.position.set(...DEFAULT_CAMERA_POSITION);
    this.target.set(...DEFAULT_CAMERA_TARGET);
  }

  camera(): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(50, 1920 / 1080, 0.1, 1000);
    camera.position.copy(this.position);
    camera.lookAt(this.target);
    camera.updateMatrixWorld();
    return camera;
  }

  step(core: ViewerCore, deltaMs: number): void {
    const sample = core.tick(deltaMs);
    if (sample) {
      this.position.copy(sample.position);
      this.target.copy(sample.target);
    }
  }
}

describe('ViewerCore 状态机', () => {
  let core: ViewerCore;

  beforeEach(() => {
    core = new ViewerCore(VIEWPORT);
  });

  it('初始为分子选择态，无分子无标注', () => {
    expect(core.mode).toBe('selection');
    expect(core.molecule).toBeNull();
    expect(core.selectedAtomIndex).toBeNull();
    expect(core.isTweening).toBe(false);
  });

  it('选择分子后进入查看态并完成几何构建', () => {
    core.selectMolecule(H2O);
    expect(core.mode).toBe('viewing');
    expect(core.molecule).toBe(H2O);
    expect(core.spec?.atoms).toHaveLength(3);
  });

  it('返回后回到选择态且无残留', () => {
    core.selectMolecule(H2O);
    core.back();
    expect(core.mode).toBe('selection');
    expect(core.molecule).toBeNull();
    expect(core.spec).toBeNull();
    expect(core.selectedAtomIndex).toBeNull();
    expect(core.hoveredAtomIndex).toBeNull();
    expect(core.isTweening).toBe(false);
  });
});

describe('ViewerCore 切换最佳视角补间', () => {
  it('补间完成后相机恰好到达 bestViewAngle、目标回到原点', () => {
    const core = new ViewerCore(VIEWPORT);
    const rig = new CameraRig();
    core.selectMolecule(CO2);

    const tween = core.toggleView(rig.position, rig.target);
    expect(tween).not.toBeNull();
    expect(core.isTweening).toBe(true);

    for (let elapsed = 16; elapsed < 2000; elapsed += 16) {
      rig.step(core, 16);
      expect(core.isTweening).toBe(true);
    }
    rig.step(core, 100);

    expect(core.isTweening).toBe(false);
    expect(rig.position.toArray()).toEqual(CO2.bestViewAngle);
    expect(rig.target.toArray()).toEqual(DEFAULT_CAMERA_TARGET);
  });

  it('补间未结束时再次切换被忽略，最终状态与单次切换一致', () => {
    const interrupted = new ViewerCore(VIEWPORT);
    const rigA = new CameraRig();
    interrupted.selectMolecule(CO2);
    interrupted.toggleView(rigA.position, rigA.target);
    rigA.step(interrupted, 500);

    const ignoredTween = interrupted.toggleView(new THREE.Vector3(5, 5, 5), rigA.target);
    expect(ignoredTween).toBeNull();
    rigA.step(interrupted, 2000);

    const single = new ViewerCore(VIEWPORT);
    const rigB = new CameraRig();
    single.selectMolecule(CO2);
    single.toggleView(rigB.position, rigB.target);
    rigB.step(single, 3000);

    expect(rigA.position.toArray()).toEqual(rigB.position.toArray());
    expect(rigA.target.toArray()).toEqual(rigB.target.toArray());
    expect(rigA.position.toArray()).toEqual(CO2.bestViewAngle);
  });

  it('补间中途返回，补间立即取消，无中间态残留', () => {
    const core = new ViewerCore(VIEWPORT);
    const rig = new CameraRig();
    core.selectMolecule(C6H6);
    core.toggleView(rig.position, rig.target);
    rig.step(core, 300);
    expect(core.isTweening).toBe(true);

    core.back();
    expect(core.isTweening).toBe(false);
    expect(core.molecule).toBeNull();
    expect(core.tick(1000)).toBeNull();
  });
});

describe('ViewerCore 连续选择与返回再进入的收敛性', () => {
  it('连续选择不同分子，最终状态等同于单独选择最后一个', () => {
    const sequence = new ViewerCore(VIEWPORT);
    sequence.selectMolecule(H2O);
    sequence.selectMolecule(CO2);
    sequence.selectMolecule(C6H6);

    const fresh = new ViewerCore(VIEWPORT);
    fresh.selectMolecule(C6H6);

    expect(sequence.molecule).toBe(fresh.molecule);
    expect(sequence.mode).toBe('viewing');
    expect(sequence.selectedAtomIndex).toBeNull();
    expect(sequence.isTweening).toBe(false);
    expect(sequence.spec?.atoms).toHaveLength(12);
  });

  it('返回后再进入，最终状态与单次进入一致', () => {
    const sequence = new ViewerCore(VIEWPORT);
    sequence.selectMolecule(H2O);
    const rig = new CameraRig();
    sequence.toggleView(rig.position, rig.target);
    rig.step(sequence, 2000);
    sequence.back();

    sequence.selectMolecule(H2O);

    const fresh = new ViewerCore(VIEWPORT);
    fresh.selectMolecule(H2O);

    expect(sequence.molecule).toBe(fresh.molecule);
    expect(sequence.selectedAtomIndex).toBeNull();
    expect(sequence.isTweening).toBe(false);
    expect(sequence.spec?.atoms.length).toBe(fresh.spec?.atoms.length);
  });

  it('补间中途切到另一个分子，补间取消且新分子视角为默认态', () => {
    const core = new ViewerCore(VIEWPORT);
    const rig = new CameraRig();
    core.selectMolecule(CO2);
    core.toggleView(rig.position, rig.target);
    rig.step(core, 800);

    core.selectMolecule(H2O);
    expect(core.isTweening).toBe(false);
    expect(core.molecule).toBe(H2O);
    expect(core.tick(1000)).toBeNull();
  });
});

describe('ViewerCore 点击原子与标注', () => {
  function screenCoordsOf(core: ViewerCore, atomIndex: number): { x: number; y: number } {
    const atom = core.spec!.atoms[atomIndex];
    const camera = makeCamera([0, 0, 8]);
    const screen = worldToScreen(new THREE.Vector3(...atom.position), camera, core.viewport);
    return { x: screen.x, y: screen.y };
  }

  it('点击原子 → 选中；再次点击同一原子 → 取消选中', () => {
    const core = new ViewerCore(VIEWPORT);
    core.selectMolecule(H2O);

    const { x, y } = screenCoordsOf(core, 1);
    expect(core.clickAt(x, y, makeCamera([0, 0, 8]))).toEqual({
      kind: 'select',
      atomIndex: 1
    });
    expect(core.selectedAtomIndex).toBe(1);

    expect(core.clickAt(x, y, makeCamera([0, 0, 8]))).toEqual({
      kind: 'deselect',
      atomIndex: 1
    });
    expect(core.selectedAtomIndex).toBeNull();
  });

  it('已选中时点击空白处 → 清除选中；未选中时点击空白 → 无变化', () => {
    const core = new ViewerCore(VIEWPORT);
    core.selectMolecule(H2O);

    expect(core.clickAt(1800, 1000, makeCamera([0, 0, 8]))).toEqual({ kind: 'none' });

    const { x, y } = screenCoordsOf(core, 0);
    core.clickAt(x, y, makeCamera([0, 0, 8]));
    expect(core.clickAt(1800, 1000, makeCamera([0, 0, 8]))).toEqual({ kind: 'clear' });
    expect(core.selectedAtomIndex).toBeNull();
  });

  it('hover 返回当前原子序号，离开时返回 null', () => {
    const core = new ViewerCore(VIEWPORT);
    core.selectMolecule(H2O);
    const camera = makeCamera([0, 0, 8]);

    const { x, y } = screenCoordsOf(core, 2);
    expect(core.hoverAt(x, y, camera)).toBe(2);
    expect(core.hoveredAtomIndex).toBe(2);
    expect(core.hoverAt(1800, 1000, camera)).toBeNull();
    expect(core.hoveredAtomIndex).toBeNull();
  });

  it('标注落点为原子投影位置上方 70px', () => {
    const core = new ViewerCore(VIEWPORT);
    core.selectMolecule(H2O);
    const camera = makeCamera([0, 0, 8]);
    core.clickAt(screenCoordsOf(core, 0).x, screenCoordsOf(core, 0).y, camera);

    const atom = core.spec!.atoms[0];
    const expected = labelAnchor(
      worldToScreen(new THREE.Vector3(...atom.position), camera, VIEWPORT)
    );
    expect(core.selectedLabelAnchor(camera)).toEqual(expected);
    expect(core.selectedLabelAnchor(camera)?.y).toBe(expected.y);
  });

  it('窗口尺寸变化后，标注落点随之更新', () => {
    const core = new ViewerCore(VIEWPORT);
    core.selectMolecule(H2O);
    const camera = makeCamera([0, 0, 8]);
    const { x, y } = screenCoordsOf(core, 0);
    core.clickAt(x, y, camera);

    const before = core.selectedLabelAnchor(camera)!;

    core.setViewport({ left: 0, top: 0, width: 800, height: 600 });
    const smallCamera = makeCamera([0, 0, 8], [0, 0, 0], { width: 800, height: 600 });
    const after = core.selectedLabelAnchor(smallCamera)!;

    expect(after).not.toEqual(before);
    expect(after.x).toBeCloseTo(400, 5);
    expect(after.y).toBeCloseTo(300 - 70, 5);
  });

  it('选择态下点击与 hover 均不产生任何状态变化', () => {
    const core = new ViewerCore(VIEWPORT);
    expect(core.clickAt(960, 540, makeCamera([0, 0, 8]))).toEqual({ kind: 'none' });
    expect(core.hoverAt(960, 540, makeCamera([0, 0, 8]))).toBeNull();
  });

  it('返回后标注状态清空，不再给出锚点', () => {
    const core = new ViewerCore(VIEWPORT);
    core.selectMolecule(H2O);
    const camera = makeCamera([0, 0, 8]);
    const { x, y } = screenCoordsOf(core, 0);
    core.clickAt(x, y, camera);
    expect(core.selectedAtomIndex).toBe(0);

    core.back();
    expect(core.selectedLabelAnchor(camera)).toBeNull();
  });
});

describe('ViewerCore NDC 换算口径与原页面一致', () => {
  it('屏幕中心换算为 NDC(0,0)，右下角为 (1,-1)', () => {
    expect(screenToNdc(960, 540, VIEWPORT)).toEqual({ x: 0, y: 0 });
    expect(screenToNdc(1920, 1080, VIEWPORT)).toEqual({ x: 1, y: -1 });
    expect(screenToNdc(0, 0, VIEWPORT)).toEqual({ x: -1, y: 1 });
  });
});
