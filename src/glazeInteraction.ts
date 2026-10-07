import * as THREE from 'three'
import { GlazeStroke } from './store'

const MIN_U = 0.1
const MAX_U = 0.9
const MIN_V = 0.15
const MAX_V = 0.85

export const isInGlazeArea = (uv: [number, number]): boolean => {
  return uv[0] >= MIN_U && uv[0] <= MAX_U && uv[1] >= MIN_V && uv[1] <= MAX_V
}

export const raycastToUV = (
  event: MouseEvent,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  potMesh: THREE.Mesh
): [number, number] | null => {
  const rect = canvas.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  const y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(x, y), camera)
  
  const intersects = raycaster.intersectObject(potMesh)
  
  if (intersects.length > 0 && intersects[0].uv) {
    return [intersects[0].uv.x, intersects[0].uv.y]
  }
  
  return null
}

export const screenToWorld = (
  x: number,
  y: number,
  camera: THREE.Camera,
  targetZ: number = 0
): THREE.Vector3 => {
  const vector = new THREE.Vector3()
  vector.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1, 0.5)
  vector.unproject(camera)
  
  const dir = vector.sub(camera.position).normalize()
  const distance = (targetZ - camera.position.z) / dir.z
  const pos = camera.position.clone().add(dir.multiplyScalar(distance))
  
  return pos
}

export const sampleUVOnPot = (
  uv: [number, number],
  camera: THREE.Camera,
  potMesh: THREE.Mesh
): THREE.Vector3 | null => {
  const position = potMesh.geometry.attributes.position
  const uvAttr = potMesh.geometry.attributes.uv
  
  for (let i = 0; i < uvAttr.count; i++) {
    const u = uvAttr.getX(i)
    const v = uvAttr.getY(i)
    
    if (Math.abs(u - uv[0]) < 0.02 && Math.abs(v - uv[1]) < 0.02) {
      const localPos = new THREE.Vector3(
        position.getX(i),
        position.getY(i),
        position.getZ(i)
      )
      return potMesh.localToWorld(localPos)
    }
  }
  
  return null
}

export const interpolateStroke = (
  startUV: [number, number],
  endUV: [number, number],
  steps: number = 10
): [number, number][] => {
  const points: [number, number][] = []
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    points.push([
      startUV[0] + (endUV[0] - startUV[0]) * t,
      startUV[1] + (endUV[1] - startUV[1]) * t,
    ])
  }
  
  return points
}

export const createStrokeFromDrag = (
  startUV: [number, number],
  endUV: [number, number],
  glazeId: string,
  thickness: number
): GlazeStroke | null => {
  const validStart = isInGlazeArea(startUV)
  const validEnd = isInGlazeArea(endUV)
  
  if (!validStart && !validEnd) {
    return null
  }
  
  const clampedStart: [number, number] = [
    Math.max(MIN_U, Math.min(MAX_U, startUV[0])),
    Math.max(MIN_V, Math.min(MAX_V, startUV[1])),
  ]
  
  const clampedEnd: [number, number] = [
    Math.max(MIN_U, Math.min(MAX_U, endUV[0])),
    Math.max(MIN_V, Math.min(MAX_V, endUV[1])),
  ]
  
  const uvCoords = interpolateStroke(clampedStart, clampedEnd, 15)
  
  return {
    id: '',
    glazeId,
    uvCoords,
    thickness,
    timestamp: 0,
  }
}

export const getGlazeColorWithThickness = (
  baseColor: string,
  thickness: number
): string => {
  const color = new THREE.Color(baseColor)
  const factor = 0.7 + thickness * 0.6
  color.r = Math.min(1, color.r * factor)
  color.g = Math.min(1, color.g * factor)
  color.b = Math.min(1, color.b * factor)
  return `#${color.getHexString()}`
}

export const hexToRgb = (hex: string): [number, number, number] => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? [
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255,
      ]
    : [1, 1, 1]
}
