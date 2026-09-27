import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { generateGalaxy, GalaxyParams } from './galaxy'
import { ParticleSystem } from './particle'

let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
let particleSystem: ParticleSystem | null = null

let particleCount = 3000
let rotationSpeed = 1.0
let vividness = 1.0

const clock = new THREE.Clock()
let elapsedTime = 0

const CENTER_COLOR = new THREE.Color(0xff6633)
const EDGE_COLOR = new THREE.Color(0x4477ff)
const GALAXY_RADIUS = 5

let raycaster: THREE.Raycaster
let mouse: THREE.Vector2
let isMouseDown = false

let frameCount = 0
let fpsTime = 0
let currentFps = 60

let pendingRebuild: {
  active: boolean
  targetCount: number
  newGeometry: THREE.BufferGeometry | null
  newBaseSizes: Float32Array | null
  newBaseColors: Float32Array | null
  processed: number
} | null = null

function init() {
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0a0a1a)
  scene.fog = new THREE.FogExp2(0x0a0a1a, 0.08)

  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.001,
    1000
  )
  camera.position.set(0, 2, 6)

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  document.body.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.95
  controls.minDistance = 1.5
  controls.maxDistance = 20
  controls.enablePan = false

  raycaster = new THREE.Raycaster()
  raycaster.params.Points = { threshold: 0.1 }
  mouse = new THREE.Vector2()

  window.addEventListener('resize', onWindowResize)
  renderer.domElement.addEventListener('mousedown', () => { isMouseDown = true })
  renderer.domElement.addEventListener('mouseup', () => { isMouseDown = false })
  renderer.domElement.addEventListener('mouseleave', () => { isMouseDown = false })
  renderer.domElement.addEventListener('mousemove', onMouseMove)

  setupControls()
  setupMobileDrawer()
  buildGalaxy(particleCount, vividness)
  animate()
}

function buildGalaxy(count: number, vivid: number) {
  const params: GalaxyParams = {
    particleCount: count,
    mainArms: 4,
    smallArms: 2,
    radius: GALAXY_RADIUS,
    centerColor: CENTER_COLOR,
    edgeColor: EDGE_COLOR,
    vividness: vivid,
  }

  const { geometry, baseSizes, baseColors } = generateGalaxy(params)

  if (particleSystem) {
    pendingRebuild = {
      active: true,
      targetCount: count,
      newGeometry: geometry,
      newBaseSizes: baseSizes,
      newBaseColors: baseColors,
      processed: 0,
    }
  } else {
    particleSystem = new ParticleSystem(geometry, baseSizes, baseColors)
    particleSystem.setRotationSpeed(rotationSpeed)
    scene.add(particleSystem.points)
  }
}

function processRebuild() {
  if (!pendingRebuild || !pendingRebuild.active || !particleSystem) return
  if (!pendingRebuild.newGeometry || !pendingRebuild.newBaseSizes || !pendingRebuild.newBaseColors) return

  const batchSize = 500
  const { newGeometry, newBaseSizes, newBaseColors, targetCount } = pendingRebuild

  const currentCount = particleSystem.count
  const startIdx = pendingRebuild.processed
  const endIdx = Math.min(startIdx + batchSize, targetCount)

  const oldPosAttr = particleSystem.geometry.getAttribute('position') as THREE.BufferAttribute
  const oldColorAttr = particleSystem.geometry.getAttribute('color') as THREE.BufferAttribute
  const oldSizeAttr = particleSystem.geometry.getAttribute('size') as THREE.BufferAttribute

  const newPosAttr = newGeometry.getAttribute('position') as THREE.BufferAttribute
  const newColorAttr = newGeometry.getAttribute('color') as THREE.BufferAttribute
  const newSizeAttr = newGeometry.getAttribute('size') as THREE.BufferAttribute

  if (targetCount !== currentCount) {
    if (pendingRebuild.processed === 0) {
      const newPositions = new Float32Array(targetCount * 3)
      const newColors = new Float32Array(targetCount * 3)
      const newSizes = new Float32Array(targetCount)

      particleSystem.geometry.setAttribute('position', new THREE.BufferAttribute(newPositions, 3))
      particleSystem.geometry.setAttribute('color', new THREE.BufferAttribute(newColors, 3))
      particleSystem.geometry.setAttribute('size', new THREE.BufferAttribute(newSizes, 1))
      particleSystem.geometry.attributes.position.needsUpdate = true
      particleSystem.geometry.attributes.color.needsUpdate = true
      particleSystem.geometry.attributes.size.needsUpdate = true

      particleSystem.baseSizes = new Float32Array(targetCount)
      particleSystem.baseColors = new Float32Array(targetCount * 3)
      particleSystem.currentSizes = new Float32Array(targetCount)
      particleSystem.currentColors = new Float32Array(targetCount * 3)
      particleSystem.targetSizes = new Float32Array(targetCount)
      particleSystem.targetColors = new Float32Array(targetCount * 3)
      particleSystem.twinklePhase = new Float32Array(targetCount)
      for (let i = 0; i < targetCount; i++) {
        particleSystem.twinklePhase[i] = Math.random() * Math.PI * 2
      }
      particleSystem.count = targetCount
    }

    const posAttr = particleSystem.geometry.getAttribute('position') as THREE.BufferAttribute
    const colAttr = particleSystem.geometry.getAttribute('color') as THREE.BufferAttribute
    const szAttr = particleSystem.geometry.getAttribute('size') as THREE.BufferAttribute

    for (let i = startIdx; i < endIdx; i++) {
      posAttr.setXYZ(i, newPosAttr.getX(i), newPosAttr.getY(i), newPosAttr.getZ(i))
      colAttr.setXYZ(i, newColorAttr.getX(i), newColorAttr.getY(i), newColorAttr.getZ(i))
      szAttr.setX(i, newSizeAttr.getX(i))

      particleSystem.baseSizes[i] = newBaseSizes[i]
      particleSystem.baseColors[i * 3] = newBaseColors[i * 3]
      particleSystem.baseColors[i * 3 + 1] = newBaseColors[i * 3 + 1]
      particleSystem.baseColors[i * 3 + 2] = newBaseColors[i * 3 + 2]
      particleSystem.currentSizes[i] = newBaseSizes[i]
      particleSystem.currentColors[i * 3] = newBaseColors[i * 3]
      particleSystem.currentColors[i * 3 + 1] = newBaseColors[i * 3 + 1]
      particleSystem.currentColors[i * 3 + 2] = newBaseColors[i * 3 + 2]
      particleSystem.targetSizes[i] = newBaseSizes[i]
      particleSystem.targetColors[i * 3] = newBaseColors[i * 3]
      particleSystem.targetColors[i * 3 + 1] = newBaseColors[i * 3 + 1]
      particleSystem.targetColors[i * 3 + 2] = newBaseColors[i * 3 + 2]
    }

    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
    szAttr.needsUpdate = true
  } else {
    particleSystem.updateBaseData(newBaseSizes, newBaseColors)
    pendingRebuild.processed = targetCount
  }

  pendingRebuild.processed = endIdx

  if (pendingRebuild.processed >= targetCount) {
    newGeometry.dispose()
    pendingRebuild.active = false
    pendingRebuild = null
    particleCount = targetCount
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}

function onMouseMove(event: MouseEvent) {
  if (isMouseDown || !particleSystem) {
    if (particleSystem) particleSystem.resetHighlight()
    return
  }

  mouse.x = (event.clientX / window.innerWidth) * 2 - 1
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1

  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObject(particleSystem.points)

  if (intersects.length > 0 && intersects[0].index !== undefined) {
    particleSystem.highlightParticle(intersects[0].index)
  } else {
    particleSystem.resetHighlight()
  }
}

function setupControls() {
  const particlesRange = document.getElementById('particles-range') as HTMLInputElement
  const particlesValue = document.getElementById('particles-value') as HTMLElement
  const speedRange = document.getElementById('speed-range') as HTMLInputElement
  const speedValue = document.getElementById('speed-value') as HTMLElement
  const vividRange = document.getElementById('vivid-range') as HTMLInputElement
  const vividValue = document.getElementById('vivid-value') as HTMLElement

  const bump = (el: HTMLElement) => {
    el.classList.remove('bump')
    void el.offsetWidth
    el.classList.add('bump')
  }

  particlesRange.addEventListener('input', () => {
    const val = parseInt(particlesRange.value)
    particlesValue.textContent = val.toString()
    bump(particlesValue)
    if (!pendingRebuild?.active) {
      buildGalaxy(val, vividness)
    }
  })

  speedRange.addEventListener('input', () => {
    const val = parseFloat(speedRange.value)
    speedValue.textContent = val.toFixed(1)
    bump(speedValue)
    rotationSpeed = val
    if (particleSystem) particleSystem.setRotationSpeed(val)
  })

  vividRange.addEventListener('input', () => {
    const val = parseFloat(vividRange.value)
    vividValue.textContent = val.toFixed(2)
    bump(vividValue)
    vividness = val
    if (!pendingRebuild?.active) {
      buildGalaxy(particleCount, val)
    }
  })
}

function setupMobileDrawer() {
  const panel = document.getElementById('control-panel') as HTMLElement
  const handle = document.getElementById('drawer-handle') as HTMLElement

  handle.addEventListener('click', () => {
    panel.classList.toggle('open')
  })
  panel.addEventListener('click', (e) => {
    if (e.target === panel && window.innerWidth <= 768) {
      panel.classList.toggle('open')
    }
  })
}

function updateFps(delta: number) {
  frameCount++
  fpsTime += delta

  if (fpsTime >= 0.5) {
    currentFps = Math.round(frameCount / fpsTime)
    frameCount = 0
    fpsTime = 0

    const fpsEl = document.getElementById('fps-counter')
    if (fpsEl) {
      fpsEl.textContent = `FPS: ${currentFps}`
      if (currentFps < 30) {
        fpsEl.classList.add('low')
      } else {
        fpsEl.classList.remove('low')
      }
    }
  }
}

function animate() {
  requestAnimationFrame(animate)

  const delta = clock.getDelta()
  elapsedTime += delta

  controls.update()
  processRebuild()

  if (particleSystem) {
    particleSystem.update(delta, elapsedTime)
  }

  renderer.render(scene, camera)
  updateFps(delta)
}

init()
