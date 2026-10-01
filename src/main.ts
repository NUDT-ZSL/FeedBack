import * as THREE from 'three'
import { createEnvironment } from './environment'
import { ParticleSystem } from './ParticleSystem'
import { createControls } from './controls'

const app = document.getElementById('app')!

const env = createEnvironment(app)

const particleSystem = new ParticleSystem(env.scene)

createControls(particleSystem)

const clock = new THREE.Clock()
let animationId: number

const animate = () => {
  animationId = requestAnimationFrame(animate)

  const deltaTime = Math.min(clock.getDelta(), 0.1)
  const elapsed = clock.elapsedTime

  env.controls.update()
  particleSystem.update(deltaTime)

  particleSystem.emitterMesh.rotation.y += deltaTime * 0.5
  particleSystem.emitterMesh.rotation.x += deltaTime * 0.3

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
