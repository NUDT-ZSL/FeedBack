import GUI from 'lil-gui'
import { BubbleSystem, DisplayMode } from './bubbleSystem'
import { InteractionManager } from './interaction'

export class UIManager {
  private gui: GUI
  private bubbleSystem: BubbleSystem
  private interaction: InteractionManager

  private settings = {
    scaleFactor: 1.0,
    displayMode: 'normal' as DisplayMode,
    resetView: () => {
      this.interaction.resetView()
    }
  }

  constructor(bubbleSystem: BubbleSystem, interaction: InteractionManager) {
    this.bubbleSystem = bubbleSystem
    this.interaction = interaction
    this.gui = new GUI({
      title: '控制面板',
      closeFolders: false
    })

    this.gui.domElement.style.position = 'fixed'
    this.gui.domElement.style.bottom = '20px'
    this.gui.domElement.style.right = '20px'
    this.gui.domElement.style.top = 'auto'

    this.setupControls()
    this.applyTheme()
  }

  private setupControls(): void {
    this.gui
      .add(this.settings, 'scaleFactor', 0.5, 2.0, 0.01)
      .name('气泡缩放')
      .onChange((value: number) => {
        this.bubbleSystem.setScaleFactor(value)
      })

    this.gui
      .add(this.settings, 'displayMode', {
        '正常模式': 'normal',
        '仅丝线连接': 'threads',
        '仅内部粒子': 'particles'
      })
      .name('显示模式')
      .onChange((value: DisplayMode) => {
        this.bubbleSystem.setDisplayMode(value)
      })

    this.gui
      .add(this.settings, 'resetView')
      .name('重置视角')
  }

  private applyTheme(): void {
    const style = document.createElement('style')
    style.textContent = `
      .lil-gui {
        --background-color: rgba(10, 10, 30, 0.85);
        --text-color: rgba(255, 255, 255, 0.9);
        --title-background-color: rgba(30, 30, 60, 0.9);
        --title-text-color: rgba(255, 255, 255, 0.95);
        --widget-color: rgba(50, 50, 100, 0.6);
        --hover-color: rgba(80, 80, 150, 0.8);
        --focus-color: rgba(100, 100, 200, 0.9);
        --number-color: rgba(150, 200, 255, 0.95);
        --string-color: rgba(180, 255, 200, 0.95);
        --font-size: 12px;
        --padding: 8px;
        --widget-height: 24px;
        --name-width: 35%;
        --slider-knob-width: 8px;
        border-radius: 8px;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(100, 120, 200, 0.3);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      }
      .lil-gui .title {
        font-weight: 300;
        letter-spacing: 1px;
        border-radius: 8px 8px 0 0;
      }
      .lil-gui .name {
        font-weight: 300;
      }
      .lil-gui .controller {
        font-weight: 300;
      }
      .lil-gui .widget {
        border-radius: 4px;
      }
    `
    document.head.appendChild(style)
  }
}
