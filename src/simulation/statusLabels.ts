/** 航行状态与 UI 展示文案的唯一映射：信息面板与离线验证共用 */
import type { NavigationStatus } from './types.ts'

export const NAVIGATION_STATUS_LABEL: Record<NavigationStatus, string> = {
  normal: '正常通行',
  warning: '谨慎通过',
  danger: '危险停航',
}

export function getNavigationStatusLabel(status: NavigationStatus): string {
  return NAVIGATION_STATUS_LABEL[status]
}
