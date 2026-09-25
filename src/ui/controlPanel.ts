import GUI from 'lil-gui'
import type { SharedState, RenderMode } from '../types'
import { eventBus } from '../utils/eventBus'

export class ControlPanel {
  private gui: GUI
  private state: SharedState
  private params: {
    particleCount: number
    gravity: number
    attractStrength: number
    particleSizeMin: number
    particleSizeMax: number
    renderMode: RenderMode
    reset: () => void
    attractToggle: boolean
  }

  constructor(state: SharedState) {
    this.state = state

    this.params = {
      particleCount: state.particleCount,
      gravity: state.gravity,
      attractStrength: state.attractStrength,
      particleSizeMin: state.particleSizeMin,
      particleSizeMax: state.particleSizeMax,
      renderMode: state.renderMode,
      reset: () => this.resetSystem(),
      attractToggle: true
    }

    this.gui = new GUI({
      title: '控制面板',
      container: document.body
    })

    this.setupPanel()
    this.setupMobileToggle()
  }

  private setupPanel(): void {
    const systemFolder = this.gui.addFolder('系统设置')
    systemFolder.open()

    systemFolder
      .add(this.params, 'particleCount', 100, 2000, 10)
      .name('粒子数量')
      .onChange((value: number) => {
        this.state.particleCount = value
        eventBus.emit('param-change', { key: 'particleCount', value })
      })

    systemFolder
      .add(this.params, 'reset')
      .name('重置系统')

    const physicsFolder = this.gui.addFolder('物理参数')
    physicsFolder.open()

    physicsFolder
      .add(this.params, 'gravity', 0, 50, 0.1)
      .name('重力大小')
      .onChange((value: number) => {
        this.state.gravity = value
        eventBus.emit('param-change', { key: 'gravity', value })
      })

    physicsFolder
      .add(this.params, 'attractStrength', 0, 100, 1)
      .name('吸引力强度')
      .onChange((value: number) => {
        this.state.attractStrength = value
        eventBus.emit('param-change', { key: 'attractStrength', value })
      })

    physicsFolder
      .add(this.params, 'attractToggle')
      .name('吸引/排斥')
      .onFinishChange((value: boolean) => {
        console.log(value ? '左键吸引，右键排斥' : '左键排斥，右键吸引')
      })

    const appearanceFolder = this.gui.addFolder('外观设置')
    appearanceFolder.open()

    appearanceFolder
      .add(this.params, 'particleSizeMin', 0.1, 1, 0.05)
      .name('最小半径')
      .onChange((value: number) => {
        if (value >= this.params.particleSizeMax) {
          value = this.params.particleSizeMax - 0.05
          this.params.particleSizeMin = value
        }
        this.state.particleSizeMin = value
        eventBus.emit('param-change', { key: 'particleSizeMin', value })
      })

    appearanceFolder
      .add(this.params, 'particleSizeMax', 0.2, 1.5, 0.05)
      .name('最大半径')
      .onChange((value: number) => {
        if (value <= this.params.particleSizeMin) {
          value = this.params.particleSizeMin + 0.05
          this.params.particleSizeMax = value
        }
        this.state.particleSizeMax = value
        eventBus.emit('param-change', { key: 'particleSizeMax', value })
      })

    appearanceFolder
      .add(this.params, 'renderMode', ['points', 'spheres'] as RenderMode[])
      .name('渲染模式')
      .onChange((value: RenderMode) => {
        this.state.renderMode = value
        eventBus.emit('render-mode-change', { mode: value })
      })

    const infoFolder = this.gui.addFolder('操作说明')
    infoFolder
      .add({ text: '左键拖拽: 吸引' }, 'text')
      .name('鼠标操作')
      .disable()
    
    infoFolder
      .add({ text: '右键拖拽: 排斥' }, 'text')
      .name('')
      .disable()
    
    infoFolder
      .add({ text: '滚轮: 缩放视角' }, 'text')
      .name('')
      .disable()
  }

  private setupMobileToggle(): void {
    const toggleBtn = document.getElementById('mobile-toggle')
    if (!toggleBtn) return

    const guiContainer = this.gui.domElement

    toggleBtn.addEventListener('click', () => {
      const isOpen = guiContainer.classList.contains('mobile-open')
      if (isOpen) {
        guiContainer.classList.remove('mobile-open')
        toggleBtn.classList.remove('active')
      } else {
        guiContainer.classList.add('mobile-open')
        toggleBtn.classList.add('active')
      }
    })

    const mediaQuery = window.matchMedia('(max-width: 768px)')
    const handleResize = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        guiContainer.classList.remove('mobile-open')
        toggleBtn.classList.remove('active')
      } else {
        guiContainer.classList.remove('mobile-open')
        toggleBtn.classList.remove('active')
      }
    }
    handleResize(mediaQuery)
    mediaQuery.addEventListener('change', handleResize)
  }

  private resetSystem(): void {
    this.state.collisionCount = 0
    this.params.particleCount = this.state.particleCount
    eventBus.emit('param-change', { key: 'particleCount', value: this.state.particleCount })
    eventBus.emit('param-change', { key: 'gravity', value: this.state.gravity })
  }

  update(): void {
    this.params.particleCount = this.state.particleCount
    this.params.gravity = this.state.gravity
    this.params.particleSizeMin = this.state.particleSizeMin
    this.params.particleSizeMax = this.state.particleSizeMax
    this.params.renderMode = this.state.renderMode
  }

  dispose(): void {
    this.gui.destroy()
  }
}
