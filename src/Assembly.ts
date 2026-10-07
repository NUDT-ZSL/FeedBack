import { v4 as uuidv4 } from 'uuid'

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
    id: uuidv4(),
    name: '座面',
    type: 'seat',
    processed: false,
    assembled: false,
    position: [0, 1.5, 0],
    targetPosition: [0, 1.2, 0],
    color: '#5c2a15'
  },
  {
    id: uuidv4(),
    name: '扶手',
    type: 'armrest',
    processed: false,
    assembled: false,
    position: [-1.5, 1.8, 0],
    targetPosition: [-1.2, 1.6, 0.5],
    color: '#5c2a15'
  },
  {
    id: uuidv4(),
    name: '靠背',
    type: 'backrest',
    processed: false,
    assembled: false,
    position: [0, 2.5, -0.5],
    targetPosition: [0, 1.8, -0.8],
    color: '#5c2a15'
  },
  {
    id: uuidv4(),
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

export function assembleComponent(id: string): boolean {
  const component = assemblyState.components.find(c => c.id === id)
  if (component && component.processed) {
    component.assembled = true
    component.position = [...component.targetPosition]
    checkAssemblyComplete()
    return true
  }
  return false
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

export function triggerHalo(): void {
  assemblyState.showHalo = true
  setTimeout(() => {
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
  position: [number, number, number],
  targetPosition: [number, number, number],
  threshold: number = 0.5
): boolean {
  const dx = position[0] - targetPosition[0]
  const dy = position[1] - targetPosition[1]
  const dz = position[2] - targetPosition[2]
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
  return distance < threshold
}

export function resetAssembly(): void {
  assemblyState.components = JSON.parse(JSON.stringify(initialComponents))
  assemblyState.assemblyComplete = false
  assemblyState.showHalo = false
  assemblyState.autoRotate = false
  assemblyState.currentStep = 'select'
}
