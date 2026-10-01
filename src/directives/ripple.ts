import type { Directive } from 'vue'

export const vRipple: Directive<HTMLElement> = {
  mounted(el) {
    el.addEventListener('click', (e: Event) => {
      const evt = e as MouseEvent
      const rect = el.getBoundingClientRect()
      const size = Math.max(rect.width, rect.height)
      const x = evt.clientX - rect.left - size / 2
      const y = evt.clientY - rect.top - size / 2
      const ripple = document.createElement('span')
      ripple.className = 'ripple'
      ripple.style.width = ripple.style.height = `${size}px`
      ripple.style.left = `${x}px`
      ripple.style.top = `${y}px`
      const pos = getComputedStyle(el).position
      if (pos === 'static') el.style.position = 'relative'
      if (getComputedStyle(el).overflow !== 'hidden') el.style.overflow = 'hidden'
      el.appendChild(ripple)
      setTimeout(() => ripple.remove(), 650)
    })
  }
}
