import * as THREE from 'three'
import { BubbleSystem } from './bubbleSystem'
import { InteractionManager } from './interaction'
import { UIManager } from './ui'

class CosmicBubbleViewer {
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private bubbleSystem: BubbleSystem
  private interaction: InteractionManager
  private ui: UIManager
  private clock: THREE.Clock
  private backgroundStars: THREE.Points

  constructor() {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x000011)
    this.scene.fog = new THREE.FogExp2(0x000011, 0.006)

    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    )

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setClearColor(0x000011)
    document.body.appendChild(this.renderer.domElement)

    this.clock = new THREE.Clock()

    this.createBackgroundStars()

    this.bubbleSystem = new BubbleSystem(this.scene)
    this.interaction = new InteractionManager(this.camera, this.renderer, this.bubbleSystem)
    this.ui = new UIManager(this.bubbleSystem, this.interaction)

    this.setupWindowResize()
    this.animate()
  }

  private createBackgroundStars(): void {
    const starCount = 8000
    const positions = new Float32Array(starCount * 3)
    const sizes = new Float32Array(starCount)
    const flickerSpeeds = new Float32Array(starCount)
    const flickerOffsets = new Float32Array(starCount)

    for (let i = 0; i < starCount; i++) {
      const phi = Math.acos(2 * Math.random() - 1)
      const theta = 2 * Math.PI * Math.random()
      const r = 180 + Math.random() * 100

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      positions[i * 3 + 2] = r * Math.cos(phi)

      sizes[i] = Math.random() * 0.6 + 0.2
      flickerSpeeds[i] = 0.5 + Math.random() * 2.0
      flickerOffsets[i] = Math.random() * Math.PI * 2
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('flickerSpeed', new THREE.BufferAttribute(flickerSpeeds, 1))
    geometry.setAttribute('flickerOffset', new THREE.BufferAttribute(flickerOffsets, 1))

    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 }
      },
      vertexShader: `
        attribute float size;
        attribute float flickerSpeed;
        attribute float flickerOffset;
        varying float vFlicker;
        uniform float time;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float flicker = 0.6 + 0.4 * sin(time * flickerSpeed + flickerOffset);
          vFlicker = flicker;
          gl_PointSize = size * flicker * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vFlicker;
        void main() {
          vec2 center = gl_PointCoord - vec2(0.5);
          float dist = length(center);
          if (dist > 0.5) discard;
          float alpha = (1.0 - dist * 2.0) * vFlicker;
          gl_FragColor = vec4(vec3(1.0, 1.0, 1.0), alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })

    this.backgroundStars = new THREE.Points(geometry, material)
    this.scene.add(this.backgroundStars)
  }

  private setupWindowResize(): void {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(window.innerWidth, window.innerHeight)
    })
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate)

    const delta = this.clock.getDelta()
    const elapsed = this.clock.getElapsedTime()

    const starMat = this.backgroundStars.material as THREE.ShaderMaterial
    starMat.uniforms.time.value = elapsed

    this.interaction.update(delta)
    this.bubbleSystem.update(delta, this.camera)

    this.renderer.render(this.scene, this.camera)
  }
}

new CosmicBubbleViewer()
