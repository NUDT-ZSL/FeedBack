import * as TWEEN from '@tweenjs/tween.js'
import { useSundialStore } from '../src/store/store'
import {
  deriveShadow,
  shichenForBearing,
  SHICHEN,
  DIAL_RADIUS,
  INITIAL_ELEVATION,
  INITIAL_ROTATION,
  INITIAL_SEASON,
} from '../src/lib/sundial'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  PASS ${name}`)
  } else {
    failures++
    console.log(`  FAIL ${name} ${detail}`)
  }
}

function now() {
  return TWEEN.now()
}

function advance(ms: number, step = 16) {
  const start = now()
  for (let t = step; t <= ms; t += step) {
    TWEEN.update(start + t)
  }
}

function store() {
  return useSundialStore.getState()
}

function assertConsistent(tag: string) {
  const s = store()
  const d = deriveShadow(s.gnomonElevation, s.gnomonRotation, s.currentSeason)
  const eps = 1e-9
  check(
    `${tag}: 面板影长与推算一致`,
    Math.abs(s.gnomonShadowLength - d.length) < eps,
    `panel=${s.gnomonShadowLength} derived=${d.length}`
  )
  check(
    `${tag}: 高亮时辰与推算一致`,
    s.highlightedShichen === d.highlightedShichen,
    `panel=${s.highlightedShichen} derived=${d.highlightedShichen}`
  )
  check(
    `${tag}: 影尖坐标与推算一致`,
    Math.abs(s.shadowTipX - d.tipX) < eps && Math.abs(s.shadowTipZ - d.tipZ) < eps
  )
  check(`${tag}: 晷面内外判定与推算一致`, s.shadowWithinDial === d.withinDial)
}

console.log('== 1. 初始状态自洽 ==')
assertConsistent('初始')
check('初始姿态为初值', store().gnomonElevation === INITIAL_ELEVATION && store().gnomonRotation === INITIAL_ROTATION)
check('初始节气为初值', store().currentSeason === INITIAL_SEASON)

console.log('== 2. 刻度归属确定性（压线/区间内/两刻度之间） ==')
for (const s of SHICHEN) {
  check(`压线 ${s.angle}° -> ${s.name}`, shichenForBearing(s.angle) === s.name, `got ${shichenForBearing(s.angle)}`)
}
check('区间内 100° -> 午时', shichenForBearing(100) === '午时')
check('区间内 104.9° -> 午时', shichenForBearing(104.9) === '午时')
check('跨边界 105.1° -> 未时', shichenForBearing(105.1) === '未时')
check('两刻度正中 105° 归属确定', shichenForBearing(105) === '未时', `got ${shichenForBearing(105)}`)
check('两刻度正中 255° 归属确定', shichenForBearing(255) === '子时', `got ${shichenForBearing(255)}`)
check('环绕压线 360° -> 卯时', shichenForBearing(360) === '卯时')
check('环绕区间 355° -> 卯时', shichenForBearing(355) === '卯时')

console.log('== 3. 节气切换完成后自洽 ==')
store().animateToSeason('summer')
advance(600)
assertConsistent('夏至过渡结束')
check('过渡结束仰角=太阳高度', Math.abs(store().gnomonElevation - 70) < 1e-6, `got ${store().gnomonElevation}`)

console.log('== 4. 节气过渡中手动拖动晷针（最后输入为准） ==')
store().animateToSeason('winter')
advance(200)
const midElevation = store().gnomonElevation
check('过渡进行中仰角处于中间值', midElevation > 20 && midElevation < 70, `got ${midElevation}`)
store().setGnomonElevation(33)
advance(1000)
check('手动拖动后过渡被取消，仰角停在手动值', store().gnomonElevation === 33, `got ${store().gnomonElevation}`)
check('节气仍为目标节气', store().currentSeason === 'winter')
assertConsistent('手动打断后')

console.log('== 5. 过渡期间任意时刻面板与推算一致 ==')
store().animateToSeason('summer')
{
  const start = now()
  let ok = true
  for (let t = 16; t <= 600; t += 16) {
    TWEEN.update(start + t)
    const s = store()
    const d = deriveShadow(s.gnomonElevation, s.gnomonRotation, s.currentSeason)
    if (Math.abs(s.gnomonShadowLength - d.length) > 1e-9 || s.highlightedShichen !== d.highlightedShichen) {
      ok = false
      break
    }
  }
  check('过渡全程面板与推算一致', ok)
}

console.log('== 6. 影长超出晷面半径 ==')
store().resetView()
advance(600)
store().animateToSeason('winter')
advance(600)
store().setGnomonElevation(80)
{
  const s = store()
  check('影长超过晷面半径', s.gnomonShadowLength > DIAL_RADIUS, `len=${s.gnomonShadowLength}`)
  check('判定为超出晷面', s.shadowWithinDial === false)
  const before = s.highlightedShichen
  store().setGnomonRotation(60)
  const after = store().highlightedShichen
  const d = deriveShadow(80, 60, 'winter')
  check('超半径时高亮跟随实际指向更新', after === d.highlightedShichen, `got ${after} want ${d.highlightedShichen}`)
  check('超半径时不沿用旧时辰或旧值有效', after === before || after === d.highlightedShichen)
  assertConsistent('超半径')
}

console.log('== 7. 复位校准 ==')
store().resetView()
advance(600)
check('复位后姿态回初值', Math.abs(store().gnomonElevation - INITIAL_ELEVATION) < 1e-6 && Math.abs(store().gnomonRotation - INITIAL_ROTATION) < 1e-6)
check('复位后节气回初值', store().currentSeason === INITIAL_SEASON)
{
  const d = deriveShadow(INITIAL_ELEVATION, INITIAL_ROTATION, INITIAL_SEASON)
  check('复位后高亮回一致初值', store().highlightedShichen === d.highlightedShichen)
  check('复位后影长回一致初值', Math.abs(store().gnomonShadowLength - d.length) < 1e-9)
}

console.log('== 8. 复位后立即切换节气 ==')
store().setGnomonElevation(70)
store().setGnomonRotation(45)
store().resetView()
store().animateToSeason('winter')
advance(600)
check('立即切换后停在冬至太阳高度', Math.abs(store().gnomonElevation - 20) < 1e-6, `got ${store().gnomonElevation}`)
check('旋转停在复位被打断时的值（最后输入为准）', store().gnomonRotation === 45, `got ${store().gnomonRotation}`)
check('节气为冬至', store().currentSeason === 'winter')
assertConsistent('复位后立即切换')

console.log('== 9. 复位过渡完成后再次确认初值一致 ==')
store().resetView()
advance(600)
{
  const d = deriveShadow(INITIAL_ELEVATION, INITIAL_ROTATION, INITIAL_SEASON)
  check('姿态回初值', Math.abs(store().gnomonElevation - INITIAL_ELEVATION) < 1e-6 && Math.abs(store().gnomonRotation - INITIAL_ROTATION) < 1e-6)
  check('节气回初值', store().currentSeason === INITIAL_SEASON)
  check('影长回初值', Math.abs(store().gnomonShadowLength - d.length) < 1e-9)
  check('高亮回初值', store().highlightedShichen === d.highlightedShichen)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
