import GUI from 'lil-gui'
import * as THREE from 'three'
import { ParticleSystem } from './ParticleSystem'

interface Stats {
  fps: number
  avgParticles: number
  renderTime: number
}

interface ControlParams {
  particleCount: number
  emissionRate: number
  lifetime: number
  gravity: number
  turbulence: number
  velocityX: number
  velocityY: number
  velocityZ: number
  startColor: string
  endColor: string
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
  dom.style.overflow = 'hidden'
  dom.style.zIndex = '1000'

  const params: ControlParams = {
    particleCount: particleSystem.maxParticles,
    emissionRate: particleSystem.emissionRate,
    lifetime: particleSystem.lifetime,
    gravity: particleSystem.gravity,
    turbulence: particleSystem.turbulence,
    velocityX: particleSystem.initialVelocity.x,
    velocityY: particleSystem.initialVelocity.y,
    velocityZ: particleSystem.initialVelocity.z,
    startColor: '#' + particleSystem.startColor.getHexString(),
    endColor: '#' + particleSystem.endColor.getHexString(),
    lowPerformanceMode: particleSystem.lowPerformanceMode
  }

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
  `
  document.head.appendChild(styleSheet)

  const f1 = gui.addFolder('粒子参数')
  f1.open()

  const countController = f1
    .add(params, 'particleCount', 200, 2000, 1)
    .name('粒子数量')
    .onChange((v: number) => {
      particleSystem.maxParticles = v
    })
  addBarChart(countController, params, 'particleCount', 2000, () => params.startColor)

  const rateController = f1
    .add(params, 'emissionRate', 1, 50, 1)
    .name('发射速率/秒')
    .onChange((v: number) => {
      particleSystem.emissionRate = v
    })
  addBarChart(rateController, params, 'emissionRate', 50, () => params.startColor)

  f1.add(params, 'lifetime', 2, 10, 0.1)
    .name('粒子寿命(秒)')
    .onChange((v: number) => {
      particleSystem.lifetime = v
    })

  const f2 = gui.addFolder('物理参数')
  f2.open()

  f2.add(params, 'gravity', 0, 2, 0.01)
    .name('重力强度')
    .onChange((v: number) => {
      particleSystem.gravity = v
    })

  f2.add(params, 'turbulence', 0, 5, 0.01)
    .name('湍流强度')
    .onChange((v: number) => {
      particleSystem.turbulence = v
    })

  const f3 = gui.addFolder('初始速度')
  f3.open()

  f3.add(params, 'velocityX', -5, 5, 0.1)
    .name('X 分量')
    .onChange((v: number) => {
      particleSystem.initialVelocity.x = v
    })

  f3.add(params, 'velocityY', -5, 5, 0.1)
    .name('Y 分量')
    .onChange((v: number) => {
      particleSystem.initialVelocity.y = v
    })

  f3.add(params, 'velocityZ', -5, 5, 0.1)
    .name('Z 分量')
    .onChange((v: number) => {
      particleSystem.initialVelocity.z = v
    })

  const f4 = gui.addFolder('外观设置')
  f4.open()

  f4.addColor(params, 'startColor')
    .name('起始颜色')
    .onChange((v: string) => {
      particleSystem.startColor = new THREE.Color(v)
    })

  f4.addColor(params, 'endColor')
    .name('结束颜色')
    .onChange((v: string) => {
      particleSystem.endColor = new THREE.Color(v)
    })

  f4.add(params, 'lowPerformanceMode')
    .name('低性能模式')
    .onChange((v: boolean) => {
      particleSystem.lowPerformanceMode = v
    })

  createStatsPanel(gui, particleSystem)

  return gui
}

function addBarChart(
  controller: any,
  params: ControlParams,
  key: keyof ControlParams,
  max: number,
  getColor: () => string
): void {
  const container = document.createElement('div')
  container.className = 'bar-container'

  const track = document.createElement('div')
  track.className = 'bar-track'

  const fill = document.createElement('div')
  fill.className = 'bar-fill'
  fill.style.background = getColor()
  track.appendChild(fill)

  const label = document.createElement('span')
  label.className = 'bar-label'

  container.appendChild(track)
  container.appendChild(label)

  const updateBar = () => {
    const val = params[key] as number
    const pct = Math.min(100, (val / max) * 100)
    fill.style.width = pct + '%'
    fill.style.background = getColor()
    label.textContent = `${val}/${max}`
  }

  controller.domElement.parentNode.insertBefore(container, controller.domElement.nextSibling)
  controller.onChange(updateBar)
  controller.updateDisplay()
  updateBar()

  const colorInterval = setInterval(() => {
    fill.style.background = getColor()
  }, 200)
  controller.__barInterval = colorInterval
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

  gui.domElement.appendChild(panel)

  particleSystem.setStatsCallback((stats: Stats) => {
    fpsLine.setValue(stats.fps.toString())
    particleLine.setValue(stats.avgParticles.toString())
    renderLine.setValue(stats.renderTime.toFixed(2) + ' ms')
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
