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

  const { geometry, positions, baseSizes, baseColors } = generateGalaxy(params)

  if (particleSystem) {
    particleSystem.startTransition(positions, baseSizes, baseColors)
    geometry.dispose()
  } else {
    particleSystem = new ParticleSystem(geometry, baseSizes, baseColors)
    particleSystem.setRotationSpeed(rotationSpeed)
    scene.add(particleSystem.points)
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
    particlesValue.textContent = particlesRange.value
    bump(particlesValue)
  })

  particlesRange.addEventListener('change', () => {
    const val = parseInt(particlesRange.value)
    particlesValue.textContent = val.toString()
    particleCount = val
    buildGalaxy(val, vividness)
  })

  speedRange.addEventListener('input', () => {
    const val = parseFloat(speedRange.value)
    speedValue.textContent = val.toFixed(1)
    bump(speedValue)
    rotationSpeed = val
    if (particleSystem) particleSystem.setRotationSpeed(val)
  })

  vividRange.addEventListener('input', () => {
    vividValue.textContent = parseFloat(vividRange.value).toFixed(2)
    bump(vividValue)
  })

  vividRange.addEventListener('change', () => {
    const val = parseFloat(vividRange.value)
    vividValue.textContent = val.toFixed(2)
    vividness = val
    buildGalaxy(particleCount, val)
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

  if (particleSystem) {
    particleSystem.update(delta, elapsedTime)
  }

  renderer.render(scene, camera)
  updateFps(delta)
}

init()
