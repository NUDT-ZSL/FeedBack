// 日晷推演纯函数模块：姿态/节气 -> 影长/影尖方位/时辰归属 的唯一事实来源。
// store 与 3D 场景共用这里的计算，保证面板数字与场景指向始终一致。

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export const DIAL_RADIUS = 1.5
export const DIAL_HEIGHT = 1.2
export const GNOMON_LENGTH = 1.5
export const TABLE_HEIGHT = 2

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

const DEG = Math.PI / 180

export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/**
 * 时辰归属规则（确定且无歧义）：
 * 每个时辰以其刻度为中心、前后各 15° 为所属区间；
 * 影尖恰好落在两个刻度正中间（压线）时，归入顺时针方向的下一个时辰；
 * 不做距离门槛，影尖超出晷面半径时同样按实际方位给出归属。
 */
export function shichenForAzimuth(azimuthDeg: number): string {
  const zeroIndex = SHICHEN.findIndex((s) => s.angle === 0)
  // 吸附浮点噪声，保证压线判定稳定
  const snapped = Math.round(normalizeDeg(azimuthDeg) * 1e7) / 1e7
  const sector = Math.floor((snapped + 15) / 30)
  return SHICHEN[(sector + zeroIndex) % SHICHEN.length].name
}

export interface GnomonShadowResult {
  /** 晷针影长（世界单位） */
  length: number
  /** 影尖方位角（晷面本地坐标系，已扣除晷面旋转） */
  azimuthDeg: number
  /** 影尖是否超出晷面半径 */
  beyondDial: boolean
  worldStart: [number, number, number]
  worldEnd: [number, number, number]
}

/**
 * 晷针影子：太阳方位/高度 + 晷针仰角决定影长与指向；
 * 晷面旋转只改变刻度相对影尖的位置，不改变影子在世界中的指向。
 */
export function computeGnomonShadow(
  elevationDeg: number,
  rotationDeg: number,
  season: Season
): GnomonShadowResult {
  const sun = SEASONS[season]
  const sunH = sun.sunHeight * DEG
  const sunA = sun.sunAngle * DEG
  const elev = elevationDeg * DEG

  const tanSun = Math.max(0.1, Math.tan(sunH))
  const length = (GNOMON_LENGTH * Math.sin(elev)) / tanSun

  // 太阳水平投影方向，影子指向其反方向（世界系，与晷面旋转无关）
  const sunHorizX = Math.cos(sunA) * Math.cos(sunH)
  const sunHorizZ = Math.sin(sunA) * Math.cos(sunH)
  const sunHorizLen = Math.hypot(sunHorizX, sunHorizZ) || 1
  const dirX = -sunHorizX / sunHorizLen
  const dirZ = -sunHorizZ / sunHorizLen

  const worldStart: [number, number, number] = [0, DIAL_HEIGHT + 0.001, 0]
  const worldEnd: [number, number, number] = [
    dirX * length,
    DIAL_HEIGHT + 0.001,
    dirZ * length,
  ]

  const worldAzimuth = Math.atan2(dirZ, dirX) / DEG
  const azimuthDeg = normalizeDeg(worldAzimuth - rotationDeg)

  return {
    length,
    azimuthDeg,
    beyondDial: length > DIAL_RADIUS,
    worldStart,
    worldEnd,
  }
}

export interface TableShadowResult {
  length: number
  /** 影表组件本地坐标（组件自身已平移到 x=4） */
  localStart: [number, number, number]
  localEnd: [number, number, number]
}

export function computeTableShadow(season: Season): TableShadowResult {
  const sun = SEASONS[season]
  const sunH = sun.sunHeight * DEG
  const sunA = sun.sunAngle * DEG

  const tanSun = Math.max(0.1, Math.tan(sunH))
  const length = TABLE_HEIGHT / tanSun

  const sunHorizX = Math.cos(sunA) * Math.cos(sunH)
  const sunHorizZ = Math.sin(sunA) * Math.cos(sunH)
  const sunHorizLen = Math.hypot(sunHorizX, sunHorizZ) || 1
  const dirX = -sunHorizX / sunHorizLen
  const dirZ = -sunHorizZ / sunHorizLen

  return {
    length,
    localStart: [0, 0.01, 0],
    localEnd: [dirX * length, 0.01, dirZ * length],
  }
}

export interface SundialDerived {
  gnomonShadowLength: number
  shadowLength: number
  highlightedShichen: string
  shadowBeyondDial: boolean
}

/** 单条推演链路：姿态 + 节气 -> 影长 + 时辰高亮，任何时刻结果自洽。 */
export function deriveSundial(
  elevationDeg: number,
  rotationDeg: number,
  season: Season
): SundialDerived {
  const gnomon = computeGnomonShadow(elevationDeg, rotationDeg, season)
  const table = computeTableShadow(season)
  return {
    gnomonShadowLength: gnomon.length,
    shadowLength: table.length,
    highlightedShichen: shichenForAzimuth(gnomon.azimuthDeg),
    shadowBeyondDial: gnomon.beyondDial,
  }
}
