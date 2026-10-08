import { createId } from './lib/id.ts'

export type ComponentType = 'seat' | 'armrest' | 'backrest' | 'footrest'

export interface FurnitureComponent {
  id: string
  name: string
  type: ComponentType
  processed: boolean
  assembled: boolean
  position: [number, number, number]
  targetPosition: [number, number, number]
  color: string
}

export type AssemblyStep = 'select' | 'process' | 'assemble' | 'display'

interface AssemblyState {
  components: FurnitureComponent[]
  assemblyComplete: boolean
  showHalo: boolean
  autoRotate: boolean
  currentStep: AssemblyStep
}

const initialComponents: FurnitureComponent[] = [
  {
    id: createId(),
    name: '座面',
    type: 'seat',
    processed: false,
    assembled: false,
    position: [0, 1.5, 0],
    targetPosition: [0, 1.2, 0],
    color: '#5c2a15'
  },
  {
    id: createId(),
    name: '扶手',
    type: 'armrest',
    processed: false,
    assembled: false,
    position: [-1.5, 1.8, 0],
    targetPosition: [-1.2, 1.6, 0.5],
    color: '#5c2a15'
  },
  {
    id: createId(),
    name: '靠背',
    type: 'backrest',
    processed: false,
    assembled: false,
    position: [0, 2.5, -0.5],
    targetPosition: [0, 1.8, -0.8],
    color: '#5c2a15'
  },
  {
    id: createId(),
    name: '踏脚',
    type: 'footrest',
    processed: false,
    assembled: false,
    position: [0, 1.2, 1.5],
    targetPosition: [0, 0.8, 1.2],
    color: '#5c2a15'
  }
]

const assemblyState: AssemblyState = {
  components: JSON.parse(JSON.stringify(initialComponents)),
  assemblyComplete: false,
  showHalo: false,
  autoRotate: false,
  currentStep: 'select'
}

export function getComponents(): FurnitureComponent[] {
  return JSON.parse(JSON.stringify(assemblyState.components))
}

export function markComponentProcessed(type: ComponentType): void {
  const component = assemblyState.components.find(c => c.type === type)
  if (component) {
    component.processed = true
  }
}

export function markAllProcessed(): void {
  assemblyState.components.forEach(c => c.processed = true)
}

/**
 * 构件是否允许拖拽：加工完成且尚未组装。
 * UI 的 draggable 条件与业务侧组装前置条件统一使用此判定，
 * 保证「加工完成标记」与「可拖拽条件」始终一致。
 */
export function canDragComponent(component: FurnitureComponent | null | undefined): boolean {
  return !!component && component.processed && !component.assembled
}

export function assembleComponent(id: string): boolean {
  const component = assemblyState.components.find(c => c.id === id)
  if (!component || !component.processed || component.assembled) {
    return false
  }
  component.assembled = true
  component.position = [...component.targetPosition]
  checkAssemblyComplete()
  return true
}

/**
 * 一次完整的「拖放吸附 → 组装」判定：
 * 1. 构件存在、已加工且未组装；
 * 2. 落点与目标位置距离在阈值内（含边界）。
 * 任一条件不满足都不会改变状态，并返回 false。
 */
export function tryAssembleComponent(
  id: string,
  position: [number, number, number] | null | undefined,
  threshold: number = 0.5
): boolean {
  const component = assemblyState.components.find(c => c.id === id)
  if (!canDragComponent(component)) return false
  if (!checkSnapDistance(position, component!.targetPosition, threshold)) return false
  return assembleComponent(id)
}

export function checkAssemblyComplete(): boolean {
  const allAssembled = assemblyState.components.every(c => c.assembled)
  if (allAssembled && !assemblyState.assemblyComplete) {
    assemblyState.assemblyComplete = true
    assemblyState.currentStep = 'display'
    triggerHalo()
  }
  return allAssembled
}

let haloTimer: ReturnType<typeof setTimeout> | null = null

export function triggerHalo(): void {
  if (assemblyState.showHalo || haloTimer !== null) return
  assemblyState.showHalo = true
  haloTimer = setTimeout(() => {
    haloTimer = null
    assemblyState.showHalo = false
    assemblyState.autoRotate = true
  }, 1500)
}

export function isAssemblyComplete(): boolean {
  return assemblyState.assemblyComplete
}

export function shouldShowHalo(): boolean {
  return assemblyState.showHalo
}

export function isAutoRotate(): boolean {
  return assemblyState.autoRotate
}

export function setAutoRotate(value: boolean): void {
  assemblyState.autoRotate = value
}

export function getCurrentStep(): AssemblyStep {
  return assemblyState.currentStep
}

export function setCurrentStep(step: AssemblyStep): void {
  assemblyState.currentStep = step
}

export function checkSnapDistance(
  position: [number, number, number] | null | undefined,
  targetPosition: [number, number, number] | null | undefined,
  threshold: number = 0.5
): boolean {
  if (!isFiniteVector(position) || !isFiniteVector(targetPosition)) return false
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0) return false
  const dx = position![0] - targetPosition![0]
  const dy = position![1] - targetPosition![1]
  const dz = position![2] - targetPosition![2]
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
  return distance <= threshold
}

function isFiniteVector(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(n => typeof n === 'number' && Number.isFinite(n))
  )
}

export function resetAssembly(): void {
  if (haloTimer !== null) {
    clearTimeout(haloTimer)
    haloTimer = null
  }
  assemblyState.components = JSON.parse(JSON.stringify(initialComponents))
  assemblyState.assemblyComplete = false
  assemblyState.showHalo = false
  assemblyState.autoRotate = false
  assemblyState.currentStep = 'select'
}
