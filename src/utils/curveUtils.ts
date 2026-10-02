import * as THREE from 'three'
import { CatmullRomCurve3, Vector3 } from 'three'

export const generateDuctPoints = (
  slope: number,
  curvature: number,
  segments: number = 100
): Vector3[] => {
  const points: Vector3[] = []
  const curveLength = 12
  const slopeRad = (slope * Math.PI) / 180
  const curveRad = (curvature * Math.PI) / 180

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const x = t * curveLength - curveLength / 2

    const bendFactor = Math.sin(t * Math.PI)
    const z = bendFactor * Math.sin(curveRad) * 3
    const y = -t * Math.sin(slopeRad) * 2 - 0.3

    points.push(new Vector3(x, y, z))
  }

  return points
}

export const createDuctCurve = (points: Vector3[]): CatmullRomCurve3 => {
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5)
}

export const getPointAtCurveLength = (
  curve: CatmullRomCurve3,
  distance: number,
  totalLength: number
): Vector3 => {
  const t = Math.max(0, Math.min(1, distance / totalLength))
  return curve.getPointAt(t)
}

export const getTangentAtCurveLength = (
  curve: CatmullRomCurve3,
  distance: number,
  totalLength: number
): Vector3 => {
  const t = Math.max(0, Math.min(1, distance / totalLength))
  return curve.getTangentAt(t).normalize()
}

export const getCurveSegmentLength = (curve: CatmullRomCurve3, _segments: number = 100): number => {
  return curve.getLength()
}

export const getCentripetalOffset = (
  point: Vector3,
  tangent: Vector3,
  t: number,
  curvature: number
): Vector3 => {
  const bendFactor = Math.sin(t * Math.PI)
  const offsetAmount = bendFactor * (curvature / 90) * 0.15

  const up = new Vector3(0, 1, 0)
  const normal = new Vector3().crossVectors(tangent, up).normalize()

  const isTurning = Math.sin(t * Math.PI) > 0.1
  const direction = isTurning ? -1 : 1

  return point.clone().add(normal.multiplyScalar(offsetAmount * direction))
}

export const getVortexOffset = (
  point: Vector3,
  t: number,
  curvature: number,
  particleIndex: number
): Vector3 => {
  const bendFactor = Math.sin(t * Math.PI)
  if (bendFactor < 0.2) return point.clone()

  const vortexStrength = bendFactor * (curvature / 90) * 0.08
  const angle = (particleIndex * 0.618 + t * Math.PI * 4) % (Math.PI * 2)

  const offsetX = Math.cos(angle) * vortexStrength
  const offsetZ = Math.sin(angle) * vortexStrength

  return point.clone().add(new Vector3(offsetX, 0, offsetZ))
}

export const generateRockPoints = (): THREE.Vector3[] => {
  const rockPositions: THREE.Vector3[] = []
  const basePositions = [
    { x: -4, z: 2 },
    { x: -1, z: -2.5 },
    { x: 2, z: 2.5 },
    { x: 4, z: -1.5 }
  ]

  basePositions.forEach(pos => {
    rockPositions.push(new THREE.Vector3(pos.x, -0.5, pos.z))
  })

  return rockPositions
}

export const CUP_COLORS = ['#c0392b', '#2c3e50', '#8e44ad']
