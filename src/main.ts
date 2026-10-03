import * as THREE from 'three'
import { createEnvironment } from './environment'
import { ParticleSystem } from './ParticleSystem'
import { createControls } from './controls'

const app = document.getElementById('app')!

const env = createEnvironment(app)

const particleSystem = new ParticleSystem(env.scene)

particleSystem.addEmitter({
  id: 'core',
  position: [0, 0, 0],
  direction: [0, 1, 0],
  spread: 0.8,
  emissionRate: 30,
  initialVelocity: [0, 1.2, 0],
  diffusionSpeed: 1.5,
  lifetimeMin: 2,
  lifetimeMax: 5,
  startColor: '#00ffff',
  endColor: '#00008b'
})

particleSystem.addEmitter({
  id: 'left',
  position: [-3, -1, 0],
  direction: [0.4, 1, 0],
  spread: 0.5,
  emissionRate: 20,
  initialVelocity: [0.5, 0.8, 0],
  diffusionSpeed: 1.2,
  lifetimeMin: 2,
  lifetimeMax: 4,
  startColor: '#ff9a3c',
  endColor: '#8b0000'
})

particleSystem.addEmitter({
  id: 'right',
  position: [3, -1, 0],
  direction: [-0.4, 1, 0],
  spread: 0.5,
  emissionRate: 20,
  initialVelocity: [-0.5, 0.8, 0],
  diffusionSpeed: 1.2,
  lifetimeMin: 2,
  lifetimeMax: 4,
  startColor: '#7CFC00',
  endColor: '#013220'
})

createControls(particleSystem)

const clock = new THREE.Clock()
let animationId: number

const animate = () => {
  animationId = requestAnimationFrame(animate)

  const deltaTime = Math.min(clock.getDelta(), 0.1)
  const elapsed = clock.elapsedTime

  env.controls.update()
  particleSystem.update(deltaTime)

  for (const mesh of particleSystem.getEmitterMeshes()) {
    mesh.rotation.y += deltaTime * 0.5
    mesh.rotation.x += deltaTime * 0.3
  }

  if ((window as any).__updateStars) {
    ;(window as any).__updateStars(elapsed)
  }

  env.renderer.render(env.scene, env.camera)
}

animate()

const onResize = () => {
  env.resize()
  particleSystem.resize()
}
window.addEventListener('resize', onResize)

window.addEventListener('beforeunload', () => {
  cancelAnimationFrame(animationId)
  window.removeEventListener('resize', onResize)
  particleSystem.dispose()
  env.dispose()
})
