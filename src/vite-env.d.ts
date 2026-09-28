/// <reference types="vite/client" />

declare module 'lucide-react' {
  import type { ComponentType, SVGProps } from 'react'

  type LucideIcon = ComponentType<SVGProps<SVGSVGElement>>

  export const Search: LucideIcon
  export const X: LucideIcon
  export const Star: LucideIcon
  export const BookOpen: LucideIcon
  export const ExternalLink: LucideIcon
  export const Clock: LucideIcon
  export const CheckCircle: LucideIcon
  export const Circle: LucideIcon
  export const PlayCircle: LucideIcon
}
