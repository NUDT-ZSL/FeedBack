import { eventBus } from './eventBus'
import { SentimentAnalyzer } from './sentimentAnalyzer'
import { InputHandler } from './inputHandler'
import { BubblePhysics } from './bubblePhysics'
import { Renderer } from './renderer'
import { InteractionManager } from './interactionManager'

const canvas = document.getElementById('canvas') as HTMLCanvasElement

function resizeCanvas(): void {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
}

resizeCanvas()
window.addEventListener('resize', resizeCanvas)

new SentimentAnalyzer()
new InputHandler()
const bubblePhysics = new BubblePhysics(canvas.width, canvas.height)
const renderer = new Renderer(canvas)
new InteractionManager(canvas)

;(window as any).__bubblePhysics = bubblePhysics
;(window as any).__eventBus = eventBus

const clearBtn = document.getElementById('clearBtn')
if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    eventBus.emit('clear', undefined as void)
  })
}

window.addEventListener('resize', () => {
  bubblePhysics.resize(canvas.width, canvas.height)
  renderer.resize(canvas.width, canvas.height)
})

let lastTime = performance.now()

function animate(currentTime: number): void {
  const deltaTime = currentTime - lastTime
  lastTime = currentTime

  bubblePhysics.update(deltaTime)
  renderer.render(currentTime)

  requestAnimationFrame(animate)
}

requestAnimationFrame(animate)
