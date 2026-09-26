import { eventBus } from './eventBus'

export class InputHandler {
  private textInput: HTMLTextAreaElement
  private sendBtn: HTMLButtonElement
  private charCount: HTMLSpanElement

  constructor() {
    this.textInput = document.getElementById('textInput') as HTMLTextAreaElement
    this.sendBtn = document.getElementById('sendBtn') as HTMLButtonElement
    this.charCount = document.getElementById('charCount') as HTMLSpanElement

    this.setupEventListeners()
  }

  private setupEventListeners(): void {
    this.textInput.addEventListener('input', this.handleTextChange.bind(this))
    this.sendBtn.addEventListener('click', this.handleSend.bind(this))
    this.textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        this.handleSend()
      }
    })
  }

  private handleTextChange(): void {
    const text = this.textInput.value
    this.charCount.textContent = text.length.toString()
    this.sendBtn.disabled = text.trim().length === 0
  }

  private handleSend(): void {
    const text = this.textInput.value.trim()
    if (text.length === 0) return

    const btnRect = this.sendBtn.getBoundingClientRect()
    const originX = btnRect.left + btnRect.width / 2
    const originY = btnRect.top + btnRect.height / 2

    eventBus.emit('input', { text, originX, originY })

    this.textInput.value = ''
    this.charCount.textContent = '0'
    this.sendBtn.disabled = true
  }
}
