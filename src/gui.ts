import GUI from 'lil-gui';

export interface GUIState {
  primaryMass: number;
  secondaryMass: number;
  speedMultiplier: number;
  showOrbits: boolean;
}

export interface GUICallbacks {
  onPrimaryMassChange: (value: number) => void;
  onSecondaryMassChange: (value: number) => void;
  onSpeedChange: (value: number) => void;
  onShowOrbitsChange: (value: boolean) => void;
  onResetView: () => void;
}

export function setupGUI(state: GUIState, callbacks: GUICallbacks): GUI {
  const gui = new GUI({
    title: '控制面板',
    width: 280
  });

  const domElement = gui.domElement;
  domElement.style.position = 'absolute';
  domElement.style.top = 'auto';
  domElement.style.bottom = '20px';
  domElement.style.right = '20px';
  domElement.style.left = 'auto';
  domElement.style.background = 'rgba(255, 255, 255, 0.05)';
  domElement.style.backdropFilter = 'blur(10px)';
  (domElement.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter = 'blur(10px)';
  domElement.style.border = '1px solid rgba(255, 255, 255, 0.2)';
  domElement.style.borderRadius = '10px';
  domElement.style.overflow = 'hidden';
  domElement.style.color = '#e0e0e0';

  const style = document.createElement('style');
  style.textContent = `
    .lil-gui {
      --background-color: rgba(255, 255, 255, 0.05) !important;
      --widget-color: rgba(255, 255, 255, 0.08) !important;
      --focus-color: rgba(255, 255, 255, 0.15) !important;
      --hover-color: rgba(255, 255, 255, 0.12) !important;
      --number-color: #e0e0e0 !important;
      --string-color: #e0e0e0 !important;
      --font-color: #e0e0e0 !important;
      --title-background-color: rgba(255, 255, 255, 0.03) !important;
      --title-color: #ffffff !important;
      border: none !important;
    }
    .lil-gui .title {
      font-weight: 600 !important;
      letter-spacing: 0.5px !important;
      padding: 10px 14px !important;
    }
    .lil-gui .controller {
      transition: background-color 0.2s ease !important;
    }
    .lil-gui .controller:hover {
      background-color: rgba(255, 255, 255, 0.04) !important;
    }
    .lil-gui .slider {
      height: 4px !important;
      border-radius: 2px !important;
    }
    .lil-gui .slider > .fill {
      background: linear-gradient(90deg, #FFD700, #FF4500) !important;
      border-radius: 2px !important;
    }
    .lil-gui .widget {
      border-radius: 4px !important;
    }
    .lil-gui input[type="checkbox"] {
      accent-color: #FFD700 !important;
    }
    .lil-gui button {
      background: rgba(255, 255, 255, 0.08) !important;
      border: 1px solid rgba(255, 255, 255, 0.15) !important;
      color: #e0e0e0 !important;
      transition: all 0.2s ease !important;
      border-radius: 6px !important;
      padding: 6px 12px !important;
    }
    .lil-gui button:hover {
      background: rgba(255, 215, 0, 0.15) !important;
      border-color: rgba(255, 215, 0, 0.4) !important;
    }
  `;
  document.head.appendChild(style);

  const folderStars = gui.addFolder('恒星参数');
  folderStars.open();

  folderStars
    .add(state, 'primaryMass', 0.5, 10, 0.1)
    .name('主星质量 (M☉)')
    .onChange((v: number) => callbacks.onPrimaryMassChange(v));

  folderStars
    .add(state, 'secondaryMass', 0.5, 10, 0.1)
    .name('伴星质量 (M☉)')
    .onChange((v: number) => callbacks.onSecondaryMassChange(v));

  const folderSim = gui.addFolder('模拟参数');
  folderSim.open();

  folderSim
    .add(state, 'speedMultiplier', 0.1, 5, 0.1)
    .name('速度倍率')
    .onChange((v: number) => callbacks.onSpeedChange(v));

  folderSim
    .add(state, 'showOrbits')
    .name('显示轨道线')
    .onChange((v: boolean) => callbacks.onShowOrbitsChange(v));

  const folderView = gui.addFolder('视图控制');
  folderView.open();

  folderView
    .add({ reset: () => callbacks.onResetView() }, 'reset')
    .name('重置俯瞰视角');

  return gui;
}
