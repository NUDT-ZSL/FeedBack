import { createHash } from 'node:crypto'
import { DEFAULT_GLAZES, GlazeStroke } from './store'
import { buildGlazeComposition } from './glazeComposition'
import {
  buildCanonicalFiringHistory,
  simulateFiringFromStrokes,
  generateTextureDescription,
  FiringResult,
} from './kilnSimulation'

const line = (
  u0: number, v0: number, u1: number, v1: number, steps: number
): [number, number][] => {
  const pts: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    pts.push([u0 + (u1 - u0) * (i / steps), v0 + (v1 - v0) * (i / steps)])
  }
  return pts
}

const stroke = (
  glazeId: string,
  thickness: number,
  uvCoords: [number, number][],
  id: string,
  timestamp: number
): GlazeStroke => ({ id, glazeId, uvCoords, thickness, timestamp })

const makeStrokes = (idSalt: string, timeSalt: number): GlazeStroke[] => [
  stroke('1', 0.3, line(0.25, 0.3, 0.75, 0.35, 12), `a1-${idSalt}`, 1700000000000 + timeSalt),
  stroke('4', 0.2, line(0.35, 0.28, 0.65, 0.6, 12), `a2-${idSalt}`, 1700000001000 + timeSalt),
  stroke('5', 0.4, line(0.3, 0.62, 0.7, 0.66, 12), `a3-${idSalt}`, 1700000002000 + timeSalt),
]

interface ReplayOutput {
  result: FiringResult
  description: string
}

const runOnce = (strokes: GlazeStroke[], targetTemp: number): ReplayOutput => {
  const history = buildCanonicalFiringHistory(targetTemp)
  const result = simulateFiringFromStrokes(strokes, DEFAULT_GLAZES, history)
  return { result, description: generateTextureDescription(result) }
}

const digest = (output: ReplayOutput): string =>
  createHash('sha256').update(JSON.stringify(output)).digest('hex')

let failures = 0
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${detail}`)
  if (!ok) failures++
}

console.log('=== 1. 同一组笔迹 + 同一温度历史，多次重放逐字节一致 ===')
const TARGET = 1300
const baseline = runOnce(makeStrokes('run0', 0), TARGET)
const baselineHash = digest(baseline)
console.log(`baseline sha256: ${baselineHash}`)
console.log(`纹理类型: ${baseline.result.type}, 强度: ${baseline.result.intensity}, 斑点数: ${baseline.result.spots.length}`)
console.log(`描述: ${baseline.description}`)
for (let i = 1; i <= 5; i++) {
  const replay = runOnce(makeStrokes(`run${i}`, i * 777), TARGET)
  check(`重放 #${i}`, digest(replay) === baselineHash, digest(replay))
}

console.log('\n=== 2. 改变叠加顺序 / 厚度，纹理随之变化且可解释 ===')
const reversed = [...makeStrokes('rev', 0)].reverse()
const reversedOut = runOnce(reversed, TARGET)
check('叠加顺序改变 => 纹理改变', digest(reversedOut) !== baselineHash, digest(reversedOut))

const compA = buildGlazeComposition(makeStrokes('ord', 0), DEFAULT_GLAZES)
const compB = buildGlazeComposition(reversed, DEFAULT_GLAZES)
const keyOf = (u: number, v: number) => `${u.toFixed(4)},${v.toFixed(4)}`
const topOf = (cells: typeof compA.cells) => {
  const m = new Map<string, string>()
  cells.forEach(c => m.set(keyOf(c.u, c.v), c.layers[c.layers.length - 1].glazeId))
  return m
}
const topA = topOf(compA.cells)
const topB = topOf(compB.cells)
let flipped = 0
topA.forEach((glazeId, key) => {
  if (topB.get(key) !== undefined && topB.get(key) !== glazeId) flipped++
})
console.log(`重叠区域顶层釉料发生置换的网格数: ${flipped}`)
check('顺序变化在釉层构成中可追溯', flipped > 0, `${flipped} 个网格顶层釉料不同`)

const thicker = makeStrokes('thick', 0).map((s, i) =>
  i === 0 ? { ...s, thickness: 0.45 } : s
)
const thickerOut = runOnce(thicker, TARGET)
check('厚度改变 => 纹理改变', digest(thickerOut) !== baselineHash, digest(thickerOut))
const thickContrib = thickerOut.result.contributions.find(c => c.glazeId === '1')
const baseContrib = baseline.result.contributions.find(c => c.glazeId === '1')
console.log(
  `天青釉平均厚度: ${baseContrib?.avgThickness} -> ${thickContrib?.avgThickness}, ` +
    `斑点数: ${baseContrib?.spotCount} -> ${thickContrib?.spotCount}`
)
check(
  '厚度变化被计入釉层构成',
  (thickContrib?.avgThickness || 0) > (baseContrib?.avgThickness || 0),
  `avgThickness ${baseContrib?.avgThickness} -> ${thickContrib?.avgThickness}`
)

console.log('\n=== 3. 温度低于釉料适用区间 => 该釉料贡献为零 ===')
const lowTemp = runOnce(makeStrokes('low', 0), 1100)
console.log(`峰值温度: ${lowTemp.result.peakTemp}°C`)
lowTemp.result.contributions.forEach(c =>
  console.log(`  ${c.name}: activation=${c.activation}, spots=${c.spotCount}`)
)
check(
  '所有釉料 activation 为 0',
  lowTemp.result.contributions.every(c => c.activation === 0),
  ''
)
check(
  '所有釉料斑点数为 0',
  lowTemp.result.contributions.every(c => c.spotCount === 0) && lowTemp.result.spots.length === 0,
  ''
)
check('强度为零且类型为 none', lowTemp.result.intensity === 0 && lowTemp.result.type === 'none', '')
check(
  '描述不输出带纹理的结论',
  !/兔毫纹|油滴纹|曜变斑/.test(lowTemp.description),
  lowTemp.description
)

const midTemp = runOnce(makeStrokes('mid', 0), 1260)
const tianqing = midTemp.result.contributions.find(c => c.glazeId === '1')
const tiexiu = midTemp.result.contributions.find(c => c.glazeId === '5')
console.log(`\n1260°C 时天青釉(1200-1300) activation=${tianqing?.activation}, 铁锈花釉(1250-1320) activation=${tiexiu?.activation}`)
check(
  '处于温区内的釉料按比例产生贡献',
  (tianqing?.activation || 0) > 0 && (tiexiu?.activation || 0) > 0,
  `天青=${tianqing?.activation}, 铁锈花=${tiexiu?.activation}`
)

console.log(failures === 0 ? '\n全部验收通过' : `\n${failures} 项验收失败`)
process.exit(failures === 0 ? 0 : 1)
