import { getComponents, resetAssembly, type ComponentType } from '../src/Assembly.ts'
import { clearSelection } from '../src/Materials.ts'

/** 每个用例前复位全部共享状态：构件、步骤、木料选择。 */
export function resetAll(): void {
  resetAssembly()
  clearSelection()
}

export function componentOf(type: ComponentType) {
  return getComponents().find(c => c.type === type)!
}

export function allTypes(): ComponentType[] {
  return ['seat', 'armrest', 'backrest', 'footrest']
}
