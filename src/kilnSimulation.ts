import { TextureData, TempPoint } from './store'

class PerlinNoise {
  private permutation: number[] = []

  constructor(seed: number = Math.random() * 10000) {
    for (let i = 0; i < 256; i++) {
      this.permutation[i] = i
    }
    
    for (let i = 255; i > 0; i--) {
      const j = Math.floor((Math.sin(seed + i) * 0.5 + 0.5) * (i + 1))
      const temp = this.permutation[i]
      this.permutation[i] = this.permutation[j]
      this.permutation[j] = temp
    }
    
    for (let i = 0; i < 256; i++) {
      this.permutation[i + 256] = this.permutation[i]
    }
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10)
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a)
  }

  private grad(hash: number, x: number, y: number): number {
    const h = hash & 3
    const u = h < 2 ? x : y
    const v = h < 2 ? y : x
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
  }

  noise(x: number, y: number): number {
    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    
    x -= Math.floor(x)
    y -= Math.floor(y)
    
    const u = this.fade(x)
    const v = this.fade(y)
    
    const A = this.permutation[X] + Y
    const B = this.permutation[X + 1] + Y
    
    return this.lerp(
      this.lerp(this.grad(this.permutation[A], x, y), this.grad(this.permutation[B], x - 1, y), u),
      this.lerp(this.grad(this.permutation[A + 1], x, y - 1), this.grad(this.permutation[B + 1], x - 1, y - 1), u),
      v
    )
  }

  octaveNoise(x: number, y: number, octaves: number = 4, persistence: number = 0.5): number {
    let total = 0
    let frequency = 1
    let amplitude = 1
    let maxValue = 0
    
    for (let i = 0; i < octaves; i++) {
      total += this.noise(x * frequency, y * frequency) * amplitude
      maxValue += amplitude
      amplitude *= persistence
      frequency *= 2
    }
    
    return total / maxValue
  }
}

export const calculateTemperatureCurve = (
  elapsedTime: number,
  targetTemp: number,
  totalDuration: number = 10
): number => {
  const progress = Math.min(elapsedTime / totalDuration, 1)
  const baseTemp = 25 + (targetTemp - 25) * progress
  const waveAmplitude = targetTemp * 0.05
  const waveFrequency = 4
  const fluctuation = Math.sin(progress * Math.PI * waveFrequency) * waveAmplitude
  return Math.round(baseTemp + fluctuation)
}

export const calculateCoolingCurve = (
  elapsedTime: number,
  startTemp: number,
  totalDuration: number = 8
): number => {
  const progress = Math.min(elapsedTime / totalDuration, 1)
  const cooledTemp = startTemp - (startTemp - 200) * progress
  return Math.max(25, Math.round(cooledTemp))
}

export const getFireColor = (temp: number): string => {
  const normalizedTemp = Math.max(0, Math.min(1, (temp - 500) / 1000))
  
  const r = Math.round(255)
  const g = Math.round(69 + normalizedTemp * 186)
  const b = Math.round(normalizedTemp * 255)
  
  return `rgb(${r}, ${g}, ${b})`
}

export const generateTextureData = (
  currentTemp: number,
  targetTemp: number,
  glazeColors: string[],
  timeElapsed: number,
  seed: number = Date.now()
): TextureData => {
  const noise = new PerlinNoise(seed)
  const tempRatio = currentTemp / targetTemp
  
  let textureType: TextureData['type'] = 'none'
  if (tempRatio > 0.9) {
    textureType = 'yohen'
  } else if (tempRatio > 0.75) {
    textureType = 'oil'
  } else if (tempRatio > 0.6) {
    textureType = 'rabbit'
  }
  
  const intensity = Math.max(0, (tempRatio - 0.5) * 2) * Math.min(1, timeElapsed / 5)
  
  const spots: TextureData['spots'] = []
  
  if (textureType !== 'none') {
    const spotCount = Math.floor(20 + intensity * 30)
    
    for (let i = 0; i < spotCount; i++) {
      const angle = (i / spotCount) * Math.PI * 2 + noise.octaveNoise(i * 0.1, timeElapsed * 0.05) * 0.5
      const radius = 0.3 + noise.octaveNoise(i * 0.2, timeElapsed * 0.03) * 0.4
      
      const size = textureType === 'oil' 
        ? 0.02 + Math.random() * 0.03
        : textureType === 'rabbit'
        ? 0.005 + Math.random() * 0.01
        : 0.03 + Math.random() * 0.05
      
      const baseColor = glazeColors[i % glazeColors.length] || '#b56e7d'
      const colorVariation = noise.octaveNoise(i * 0.15, timeElapsed * 0.04)
      
      const color = new THREE.Color(baseColor)
      color.r = Math.min(1, Math.max(0, color.r + colorVariation * 0.3))
      color.g = Math.min(1, Math.max(0, color.g + colorVariation * 0.2))
      color.b = Math.min(1, Math.max(0, color.b + colorVariation * 0.25))
      
      spots.push({
        x: 0.5 + Math.cos(angle) * radius * tempRatio,
        y: 0.5 + Math.sin(angle) * radius * 0.8 * tempRatio,
        size: size * (0.5 + intensity * 0.5),
        color: `#${color.getHexString()}`,
      })
    }
  }
  
  const baseColor = glazeColors[0] ? new THREE.Color(glazeColors[0]) : new THREE.Color(0xffffff)
  
  return {
    type: textureType,
    intensity,
    colorVariation: [baseColor.r, baseColor.g, baseColor.b],
    spots,
  }
}

export const generateTextureDescription = (textureData: TextureData): string => {
  const { type, intensity, spots } = textureData
  
  if (type === 'none' || intensity < 0.1) {
    return '釉面光滑细腻，无明显窑变纹理'
  }
  
  const intensityDesc = intensity < 0.4 ? '轻度' : intensity < 0.7 ? '中度' : '显著'
  
  if (type === 'rabbit') {
    const avgSize = spots.length > 0 ? spots.reduce((sum, s) => sum + s.size, 0) / spots.length : 0
    const sizeMm = Math.round(avgSize * 100)
    return `${intensityDesc}兔毫纹，丝状纹理均匀分布，毫丝直径约${sizeMm}-${sizeMm + 2}mm`
  } else if (type === 'oil') {
    const avgSize = spots.length > 0 ? spots.reduce((sum, s) => sum + s.size, 0) / spots.length : 0
    const sizeMm = Math.round(avgSize * 100)
    return `${intensityDesc}油滴纹，斑点圆润饱满，直径约${sizeMm}-${sizeMm + 2}mm，分布疏密有致`
  } else if (type === 'yohen') {
    return `${intensityDesc}曜变斑，色斑呈现虹彩光晕，大小形态各异，如夜空中繁星闪烁`
  }
  
  return '釉面纹理独特，变化丰富'
}

export const getTempPointAtTime = (
  history: TempPoint[],
  time: number
): TempPoint | null => {
  for (let i = 0; i < history.length - 1; i++) {
    if (history[i].time <= time && history[i + 1].time >= time) {
      return history[i]
    }
  }
  return history[history.length - 1] || null
}
