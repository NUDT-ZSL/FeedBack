import GUI from 'lil-gui'
import { ParticleSystem } from './ParticleSystem'
import { EmitterConfig } from './core/engine'

interface Stats {
  fps: number
  avgParticles: number
  renderTime: number
}

interface GlobalParams {
  particleCount: number
  gravity: number
  turbulence: number
  lowPerformanceMode: boolean
}

export function createControls(particleSystem: ParticleSystem): GUI {
  const gui = new GUI({
    title: '粒子控制面板',
    width: 280,
    closeFolders: false
  })

  const dom = gui.domElement
  dom.style.position = 'fixed'
  dom.style.top = '10px'
  dom.style.right = '10px'
  dom.style.bottom = '10px'
  dom.style.height = 'auto'
  dom.style.maxHeight = 'calc(100vh - 20px)'
  dom.style.background = '#1a1a2ecc'
  dom.style.border = '1px solid #3a3a5e'
  dom.style.borderRadius = '8px'
  dom.style.backdropFilter = 'blur(10px)'
  dom.style.overflowY = 'auto'
  dom.style.zIndex = '1000'

  injectStyles()

  const globalParams: GlobalParams = {
    particleCount: particleSystem.maxParticles,
    gravity: particleSystem.gravity,
    turbulence: particleSystem.turbulence,
    lowPerformanceMode: particleSystem.lowPerformanceMode
  }

  const fGlobal = gui.addFolder('全局参数')
  fGlobal.open()

  const countController = fGlobal
    .add(globalParams, 'particleCount', 200, 2000, 1)
    .name('全局粒子上限')
    .onChange((v: number) => {
      particleSystem.maxParticles = v
    })
  addBarChart(countController, globalParams, 'particleCount', 2000)

  fGlobal
    .add(globalParams, 'gravity', 0, 2, 0.01)
    .name('重力强度')
    .onChange((v: number) => {
      particleSystem.gravity = v
    })

  fGlobal
    .add(globalParams, 'turbulence', 0, 5, 0.01)
    .name('湍流强度')
    .onChange((v: number) => {
      particleSystem.turbulence = v
    })

  fGlobal
    .add(globalParams, 'lowPerformanceMode')
    .name('低性能模式')
    .onChange((v: boolean) => {
      particleSystem.lowPerformanceMode = v
    })

  const emittersFolder = gui.addFolder('发射源管理')
  emittersFolder.open()

  const emitterFolders = new Map<string, GUI>()

  const buildEmitterFolder = (id: string) => {
    const config = particleSystem.engine.getEmitter(id)
    if (!config) return

    const folder = emittersFolder.addFolder(`发射源 ${id}`)
    folder.open()
    emitterFolders.set(id, folder)

    const apply = (changes: Partial<Omit<EmitterConfig, 'id'>>) => {
      particleSystem.updateEmitter(id, changes)
    }

    const vec = (key: 'position' | 'direction' | 'initialVelocity', label: string, min: number, max: number) => {
      const sub = folder.addFolder(label)
      const proxy = {
        x: config[key][0],
        y: config[key][1],
        z: config[key][2]
      }
      const read = () => {
        const current = particleSystem.engine.getEmitter(id)
        if (!current) return [proxy.x, proxy.y, proxy.z] as [number, number, number]
        return current[key]
      }
      sub.add(proxy, 'x', min, max, 0.1).onChange(() => {
        const [, y, z] = read()
        apply({ [key]: [proxy.x, y, z] } as Partial<Omit<EmitterConfig, 'id'>>)
      })
      sub.add(proxy, 'y', min, max, 0.1).onChange(() => {
        const [x, , z] = read()
        apply({ [key]: [x, proxy.y, z] } as Partial<Omit<EmitterConfig, 'id'>>)
      })
      sub.add(proxy, 'z', min, max, 0.1).onChange(() => {
        const [x, y] = read()
        apply({ [key]: [x, y, proxy.z] } as Partial<Omit<EmitterConfig, 'id'>>)
      })
    }

    vec('position', '位置', -10, 10)
    vec('direction', '发射方向', -1, 1)
    vec('initialVelocity', '初速度', -5, 5)

    folder
      .add(config, 'spread', 0, Math.PI, 0.01)
      .name('扩散角(弧度)')
      .onChange((v: number) => apply({ spread: v }))

    const rateController = folder
      .add(config, 'emissionRate', 0, 100, 1)
      .name('发射速率/秒')
      .onChange((v: number) => apply({ emissionRate: v }))
    addBarChart(rateController, config, 'emissionRate', 100)

    folder
      .add(config, 'diffusionSpeed', 0, 5, 0.1)
      .name('扩散速度')
      .onChange((v: number) => apply({ diffusionSpeed: v }))

    folder
      .add(config, 'lifetimeMin', 0.1, 10, 0.1)
      .name('寿命下限(秒)')
      .onChange((v: number) => apply({ lifetimeMin: v }))

    folder
      .add(config, 'lifetimeMax', 0.1, 10, 0.1)
      .name('寿命上限(秒)')
      .onChange((v: number) => apply({ lifetimeMax: v }))

    folder
      .addColor(config, 'startColor')
      .name('起始颜色')
      .onChange((v: string) => apply({ startColor: v }))

    folder
      .addColor(config, 'endColor')
      .name('结束颜色')
      .onChange((v: string) => apply({ endColor: v }))

    folder
      .add({ remove: () => {
        particleSystem.removeEmitter(id)
        const f = emitterFolders.get(id)
        if (f) {
          f.destroy()
          emitterFolders.delete(id)
        }
      } }, 'remove')
      .name('删除此发射源')
  }

  for (const config of particleSystem.engine.listEmitters()) {
    buildEmitterFolder(config.id)
  }

  emittersFolder
    .add({ add: () => {
      const id = particleSystem.addEmitter({
        position: [0, 0, 0],
        direction: [0, 1, 0],
        spread: 0.6,
        emissionRate: 20,
        initialVelocity: [0, 1, 0],
        diffusionSpeed: 1.5,
        lifetimeMin: 2,
        lifetimeMax: 5,
        startColor: '#00ffff',
        endColor: '#00008b'
      })
      buildEmitterFolder(id)
    } }, 'add')
    .name('＋ 添加发射源')

  createStatsPanel(gui, particleSystem)

  return gui
}

function addBarChart(
  controller: any,
  params: Record<string, any>,
  key: string,
  max: number
): void {
  const container = document.createElement('div')
  container.className = 'bar-container'

  const track = document.createElement('div')
  track.className = 'bar-track'

  const fill = document.createElement('div')
  fill.className = 'bar-fill'
  fill.style.background = '#00bcd4'
  track.appendChild(fill)

  const label = document.createElement('span')
  label.className = 'bar-label'

  container.appendChild(track)
  container.appendChild(label)

  const updateBar = () => {
    const val = params[key] as number
    const pct = Math.min(100, (val / max) * 100)
    fill.style.width = pct + '%'
    label.textContent = `${val}/${max}`
  }

  controller.domElement.parentNode.insertBefore(container, controller.domElement.nextSibling)
  controller.onChange(updateBar)
  controller.updateDisplay()
  updateBar()
}

function createStatsPanel(gui: GUI, particleSystem: ParticleSystem): void {
  const panel = document.createElement('div')
  panel.className = 'stats-panel'

  const fpsLine = createStatLine('FPS', '0')
  const particleLine = createStatLine('粒子数', '0')
  const renderLine = createStatLine('渲染耗时', '0.00 ms')

  panel.appendChild(fpsLine.el)
  panel.appendChild(particleLine.el)
  panel.appendChild(renderLine.el)

  const quotaContainer = document.createElement('div')
  quotaContainer.className = 'quota-container'
  panel.appendChild(quotaContainer)

  gui.domElement.appendChild(panel)

  particleSystem.setStatsCallback((stats: Stats) => {
    fpsLine.setValue(stats.fps.toString())
    particleLine.setValue(stats.avgParticles.toString())
    renderLine.setValue(stats.renderTime.toFixed(2) + ' ms')

    quotaContainer.innerHTML = ''
    for (const s of particleSystem.getEmitterStats()) {
      const line = document.createElement('div')
      line.className = 'stats-line'
      const name = document.createElement('span')
      name.className = 'stats-label'
      name.textContent = s.id
      const value = document.createElement('span')
      value.className = 'stats-value'
      value.textContent = `${s.alive}/${Math.round(s.quota)} (弃${s.dropped})`
      line.appendChild(name)
      line.appendChild(value)
      quotaContainer.appendChild(line)
    }
  })
}

function createStatLine(label: string, value: string) {
  const line = document.createElement('div')
  line.className = 'stats-line'

  const labelEl = document.createElement('span')
  labelEl.className = 'stats-label'
  labelEl.textContent = label

  const valueEl = document.createElement('span')
  valueEl.className = 'stats-value'
  valueEl.textContent = value

  line.appendChild(labelEl)
  line.appendChild(valueEl)

  return {
    el: line,
    setValue: (v: string) => {
      valueEl.textContent = v
    }
  }
}

function injectStyles(): void {
  const styleSheet = document.createElement('style')
  styleSheet.textContent = `
    .lil-gui {
      --background-color: #1a1a2ecc;
      --widget-color: #2a2a4e;
      --focus-color: #00bcd4;
      --hover-color: #3a3a5e;
      --number-color: #00bcd4;
      --string-color: #8fd4e0;
      --font-size: 12px;
      --input-font-size: 12px;
      --padding: 6px;
      --spacing: 4px;
      --widget-height: 22px;
      --name-width: 40%;
      --slider-knob-width: 10px;
      --background-color-hover: #252545;
    }
    .lil-gui .controller {
      min-height: 30px;
      padding: 3px 6px;
    }
    .lil-gui .widget > input[type="range"] {
      height: 4px;
      background: #3a3a5e;
      border-radius: 6px;
      transition: background 0.15s ease;
    }
    .lil-gui .widget > input[type="range"]::-webkit-slider-thumb {
      width: 12px;
      height: 12px;
      background: #00bcd4;
      border-radius: 50%;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 0 6px rgba(0, 188, 212, 0.5);
    }
    .lil-gui .widget > input[type="range"]::-webkit-slider-thumb:hover {
      background: #00e5ff;
      transform: scale(1.15);
      box-shadow: 0 0 12px rgba(0, 229, 255, 0.8);
    }
    .lil-gui .widget > input[type="range"]::-moz-range-thumb {
      width: 12px;
      height: 12px;
      background: #00bcd4;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .lil-gui .color {
      border-radius: 6px !important;
      overflow: hidden;
    }
    .lil-gui .boolean {
      border-radius: 6px !important;
    }
    .lil-gui .title {
      background: linear-gradient(90deg, #00bcd4, #00838f);
      color: white;
      font-weight: 600;
      padding: 10px 14px;
      border-radius: 0;
      font-size: 13px;
      letter-spacing: 0.5px;
    }
    .lil-gui .folder {
      background: transparent;
    }
    .lil-gui .children {
      padding: 6px 4px;
    }
    .bar-container {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 2px;
      padding: 0 4px;
    }
    .bar-track {
      width: 150px;
      height: 10px;
      background: #2a2a4e;
      border-radius: 5px;
      overflow: hidden;
      position: relative;
    }
    .bar-fill {
      height: 100%;
      border-radius: 5px;
      transition: width 0.3s ease, background-color 0.3s ease;
    }
    .bar-label {
      font-size: 10px;
      color: #8a8aaa;
      min-width: 45px;
      text-align: right;
    }
    .stats-panel {
      padding: 10px 12px;
      font-size: 10px;
      color: #7a8a9a;
      line-height: 1.6;
      border-top: 1px solid #3a3a5e;
      margin-top: auto;
      background: rgba(0, 0, 0, 0.2);
    }
    .stats-line {
      display: flex;
      justify-content: space-between;
      padding: 1px 0;
    }
    .stats-label {
      color: #5a6a7a;
    }
    .stats-value {
      color: #00bcd4;
      font-weight: 600;
      font-family: 'SF Mono', Consolas, monospace;
    }
    .quota-container {
      margin-top: 6px;
      border-top: 1px dashed #3a3a5e;
      padding-top: 4px;
    }
  `
  document.head.appendChild(styleSheet)
}
