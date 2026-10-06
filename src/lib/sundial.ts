export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export const SHICHEN = [
  { name: '子时', angle: 270, hours: '23:00-01:00' },
  { name: '丑时', angle: 300, hours: '01:00-03:00' },
  { name: '寅时', angle: 330, hours: '03:00-05:00' },
  { name: '卯时', angle: 0, hours: '05:00-07:00' },
  { name: '辰时', angle: 30, hours: '07:00-09:00' },
  { name: '巳时', angle: 60, hours: '09:00-11:00' },
  { name: '午时', angle: 90, hours: '11:00-13:00' },
  { name: '未时', angle: 120, hours: '13:00-15:00' },
  { name: '申时', angle: 150, hours: '15:00-17:00' },
  { name: '酉时', angle: 180, hours: '17:00-19:00' },
  { name: '戌时', angle: 210, hours: '19:00-21:00' },
  { name: '亥时', angle: 240, hours: '21:00-23:00' },
]

export const SEASONS: Record<Season, { name: string; sunHeight: number; sunAngle: number }> = {
  spring: { name: '春分', sunHeight: 45, sunAngle: 90 },
  summer: { name: '夏至', sunHeight: 70, sunAngle: 90 },
  autumn: { name: '秋分', sunHeight: 45, sunAngle: 90 },
  winter: { name: '冬至', sunHeight: 20, sunAngle: 90 },
}

export const DIAL_RADIUS = 1.5
export const GNOMON_LENGTH = 1.5
export const DIAL_CENTER_Y = 1.2
export const TABLE_HEIGHT = 2

export const INITIAL_ELEVATION = 45
export const INITIAL_ROTATION = 0
export const INITIAL_SEASON: Season = 'spring'

const DEG = Math.PI / 180
const ANGLE_EPS = 1e-6

export interface DerivedShadow {
  tipX: number
  tipZ: number
  length: number
  bearing: number
  withinDial: boolean
  highlightedShichen: string
}

export function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360
}

export function shichenForBearing(bearing: number): string {
  const normalized = normalizeAngle(bearing)
  const relative = normalizeAngle(normalized - SHICHEN[0].angle)
  const index = Math.floor((relative + 15 + ANGLE_EPS) / 30) % SHICHEN.length
  return SHICHEN[index].name
}

export function deriveShadow(
  elevationDeg: number,
  rotationDeg: number,
  season: Season
): DerivedShadow {
  const { sunHeight, sunAngle } = SEASONS[season]
  const elev = elevationDeg * DEG
  const rot = rotationDeg * DEG
  const sunH = sunHeight * DEG
  const sunA = sunAngle * DEG

  const horiz = GNOMON_LENGTH * Math.cos(elev)
  const tipLocalX = -horiz
  const tipLocalZ = 0
  const tipX = tipLocalX * Math.cos(rot) + tipLocalZ * Math.sin(rot)
  const tipZ = -tipLocalX * Math.sin(rot) + tipLocalZ * Math.cos(rot)

  const tanSun = Math.max(0.1, Math.tan(sunH))
  const sunDirX = Math.cos(sunA) * Math.cos(sunH)
  const sunDirZ = Math.sin(sunA) * Math.cos(sunH)
  const sunHorizLen = Math.hypot(sunDirX, sunDirZ) || 1
  const dirX = -sunDirX / sunHorizLen
  const dirZ = -sunDirZ / sunHorizLen

  const height = GNOMON_LENGTH * Math.sin(elev)
  const run = height / tanSun
  const shadowTipX = tipX + dirX * run
  const shadowTipZ = tipZ + dirZ * run

  const length = Math.hypot(shadowTipX, shadowTipZ)
  const bearing = normalizeAngle(Math.atan2(shadowTipZ, shadowTipX) / DEG)

  return {
    tipX: shadowTipX,
    tipZ: shadowTipZ,
    length,
    bearing,
    withinDial: length <= DIAL_RADIUS + ANGLE_EPS,
    highlightedShichen: shichenForBearing(bearing),
  }
}

export function deriveTableShadowLength(season: Season): number {
  const sunH = SEASONS[season].sunHeight * DEG
  return TABLE_HEIGHT / Math.max(0.1, Math.tan(sunH))
}
