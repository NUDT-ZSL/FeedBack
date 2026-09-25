import * as THREE from 'three'

export interface Particle {
  id: number
  position: THREE.Vector3
  velocity: THREE.Vector3
  radius: number
  color: THREE.Color
  targetColor: THREE.Color
  mass: number
  glowIntensity: number
  flashTime: number
}

export interface SharedState {
  particleCount: number
  gravity: number
  attractStrength: number
  particleSizeMin: number
  particleSizeMax: number
  renderMode: 'points' | 'spheres'
  collisionCount: number
  particles: Particle[]
  bounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
    minZ: number
    maxZ: number
  }
}

export interface CollisionEvent {
  particles: [Particle, Particle]
  position: THREE.Vector3
  time: number
}

export interface MouseForceEvent {
  position: THREE.Vector3
  strength: number
  isAttract: boolean
  radius: number
}

export type EventMap = {
  'collision': CollisionEvent
  'mouse-force': MouseForceEvent
  'param-change': { key: keyof SharedState, value: number | string }
  'render-mode-change': { mode: 'points' | 'spheres' }
  'frame-update': { delta: number, fps: number }
  'particle-count-change': { count: number }
}

export type RenderMode = 'points' | 'spheres'

export const NEON_COLORS = [
  new THREE.Color(0x00f0ff),
  new THREE.Color(0xff00ff),
  new THREE.Color(0xaaff00),
  new THREE.Color(0xff6600),
  new THREE.Color(0x00ffaa),
  new THREE.Color(0xff00aa),
  new THREE.Color(0x6666ff),
  new THREE.Color(0xffff00),
]

export function getRandomNeonColor(): THREE.Color {
  return NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)].clone()
}
