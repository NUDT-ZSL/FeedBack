import { SceneManager } from '@/core/SceneManager';
import { BuildingGenerator } from '@/modules/BuildingGenerator';
import { CollisionDetector } from '@/modules/CollisionDetector';
import { InfoPanel } from '@/ui/InfoPanel';
import { AnimationHelper } from '@/utils/AnimationHelper';
import { DefaultParams } from '@/types/bim';
import type { ComponentInfo, BuildingParams } from '@/types/bim';
import type { BIMMeshUserData } from '@/types/bim';
import * as THREE from 'three';

async function bootstrap(): Promise<void> {
  const appRoot = document.getElementById('app')!;

  const sceneManager = SceneManager.getInstance();
  const animHelper = new AnimationHelper();
  const generator = new BuildingGenerator(sceneManager, animHelper);
  const detector = new CollisionDetector(sceneManager, animHelper);
  const ui = new InfoPanel(appRoot, sceneManager, generator, detector, animHelper);

  ui.build();

  let progress = 0;
  await sceneManager.init(appRoot, (p) => {
    progress = p;
    ui.showLoadingProgress(p);
  });

  ui.showLoadingProgress(100);
  window.setTimeout(() => ui.hideLoading(), 220);

  ui.onGenerateRequest(async (params: BuildingParams) => {
    ui.hideComponentInfo();
    const comps = await generator.generate(params);
    ui.updateComponentList(comps);
    sceneManager.resetCamera();
  });

  ui.onResetView(() => {
    sceneManager.resetCamera();
  });

  ui.onCollisionModeToggle((active) => {
    if (!active) detector.clearHighlights();
  });

  const generated = await generator.generate(DefaultParams);
  ui.updateComponentList(generated);

  sceneManager.onPick((info: ComponentInfo | null, mesh: THREE.Mesh | null) => {
    if (ui['collisionModeActive']) return;
    if (!info || !mesh) {
      ui.hideComponentInfo();
      ui.setActiveComponentMesh(null);
      return;
    }
    if (info.id.startsWith('LBL-')) return;
    animHelper.highlightPulse(mesh);
    ui.setActiveComponentMesh(mesh);
    const rect = (event as MouseEvent | null)?.target instanceof HTMLElement
      ? { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 }
      : null;
    void rect;
    const clientX = (window.event as MouseEvent | undefined)?.clientX ?? window.innerWidth / 2;
    const clientY = (window.event as MouseEvent | undefined)?.clientY ?? window.innerHeight / 2;
    ui.showComponentInfo(info, clientX, clientY);
  });

  sceneManager.onFrame(() => {
    AnimationHelper.update();
  });

  let fpsTick = 0;
  let cursorTick = 0;
  sceneManager.onFrame((_dt: number) => {
    fpsTick++;
    cursorTick++;
    if (fpsTick >= 30) {
      fpsTick = 0;
      ui.updateFps(sceneManager.fps);
    }
    if (cursorTick >= 6) {
      cursorTick = 0;
      const c = (window as any).__BIMCursor as THREE.Vector3 | undefined;
      ui.updateCursor(c || null);
    }
  });

  detector.onResult((_r) => {
    ui.switchTab('collision');
  });

  sceneManager.startLoop();

  window.addEventListener('beforeunload', () => {
    sceneManager.dispose();
  });

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.info-popup')) return;
    if (target.closest('#scene-canvas')) return;
    if (target.closest('.comp-item')) return;
    if (target.closest('.collision-item')) return;
    if (target.closest('.toolbar')) return;
    if (target.closest('.side-panel')) return;
    if (target.closest('.modal-overlay')) return;
    if (!ui['collisionModeActive']) {
      ui.hideComponentInfo();
      ui.setActiveComponentMesh(null);
    }
  });

}

bootstrap().catch((err: unknown) => {
  console.error('BIM Viewer 初始化失败:', err);
});
