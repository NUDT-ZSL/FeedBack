import { StrokesManager, Stroke, Point } from './strokes-manager';
import { RecognitionEngine, RecognitionResult } from './recognition-engine';

export class UIController {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private strokesManager: StrokesManager;
  private recognitionEngine: RecognitionEngine;
  
  private isDrawing = false;
  private strokeColor = '#000000';
  private strokeWidth = 3;
  
  private characterTimeout: number | null = null;
  private characterDelay = 800;
  
  private totalCharacters = 0;
  private recognizedCount = 0;
  
  private historyStack: { strokes: Stroke[], char: string }[] = [];
  
  private highlightTimer: number | null = null;

  private textPreview: HTMLTextAreaElement;
  private resultValue: HTMLElement;
  private resultConfidence: HTMLElement;
  private progressBar: HTMLElement;
  private progressText: HTMLElement;
  private widthValue: HTMLElement;

  constructor(
    canvas: HTMLCanvasElement,
    strokesManager: StrokesManager,
    recognitionEngine: RecognitionEngine
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.strokesManager = strokesManager;
    this.recognitionEngine = recognitionEngine;

    this.textPreview = document.getElementById('text-preview') as HTMLTextAreaElement;
    this.resultValue = document.getElementById('result-value')!;
    this.resultConfidence = document.getElementById('result-confidence')!;
    this.progressBar = document.getElementById('progress-bar')!;
    this.progressText = document.getElementById('progress-text')!;
    this.widthValue = document.getElementById('width-value')!;

    this.setupEventListeners();
    this.resizeCanvas();
    this.redraw();
  }

  private setupEventListeners(): void {
    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this.canvas.addEventListener('mouseleave', this.handleMouseUp.bind(this));

    this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    this.canvas.addEventListener('touchend', this.handleTouchEnd.bind(this));
    this.canvas.addEventListener('touchcancel', this.handleTouchEnd.bind(this));

    document.getElementById('stroke-width')?.addEventListener('input', (e) => {
      this.strokeWidth = parseInt((e.target as HTMLInputElement).value);
      this.widthValue.textContent = `${this.strokeWidth}px`;
    });

    document.querySelectorAll('.color-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        (e.target as HTMLElement).classList.add('active');
        this.strokeColor = (e.target as HTMLElement).dataset.color || '#000000';
      });
    });

    document.getElementById('btn-undo')?.addEventListener('click', () => this.undo());
    document.getElementById('btn-clear')?.addEventListener('click', () => this.clear());
    document.getElementById('btn-export')?.addEventListener('click', () => this.exportTxt());

    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.redraw();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && document.activeElement !== this.textPreview) {
        e.preventDefault();
        this.deleteLastChar();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        this.undo();
      }
    });
  }

  private resizeCanvas(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
  }

  private getCanvasCoordinates(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  private handleMouseDown(e: MouseEvent): void {
    const { x, y } = this.getCanvasCoordinates(e.clientX, e.clientY);
    this.startDrawing(x, y);
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isDrawing) return;
    const { x, y } = this.getCanvasCoordinates(e.clientX, e.clientY);
    this.continueDrawing(x, y);
  }

  private handleMouseUp(): void {
    if (this.isDrawing) {
      this.endDrawing();
    }
  }

  private handleTouchStart(e: TouchEvent): void {
    e.preventDefault();
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const { x, y } = this.getCanvasCoordinates(touch.clientX, touch.clientY);
      this.startDrawing(x, y);
    }
  }

  private handleTouchMove(e: TouchEvent): void {
    e.preventDefault();
    if (!this.isDrawing || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const { x, y } = this.getCanvasCoordinates(touch.clientX, touch.clientY);
    this.continueDrawing(x, y);
  }

  private handleTouchEnd(e: TouchEvent): void {
    e.preventDefault();
    if (this.isDrawing) {
      this.endDrawing();
    }
  }

  private startDrawing(x: number, y: number): void {
    this.isDrawing = true;
    this.strokesManager.startStroke(x, y, this.strokeColor, this.strokeWidth);
    
    this.clearCharacterTimeout();
    
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.strokeStyle = this.strokeColor;
    this.ctx.lineWidth = this.strokeWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  }

  private continueDrawing(x: number, y: number): void {
    const newPoints = this.strokesManager.continueStroke(x, y);
    
    if (newPoints.length > 0) {
      const strokes = this.strokesManager.getStrokes();
      const currentStroke = strokes[strokes.length - 1];
      
      if (currentStroke) {
        this.ctx.beginPath();
        const points = currentStroke.points;
        if (points.length >= 2) {
          const lastIdx = points.length - 1;
          const startIdx = Math.max(0, lastIdx - newPoints.length - 1);
          
          this.ctx.moveTo(points[startIdx].x, points[startIdx].y);
          
          for (let i = startIdx + 1; i <= lastIdx; i++) {
            this.ctx.lineTo(points[i].x, points[i].y);
          }
          
          this.ctx.strokeStyle = this.strokeColor;
          this.ctx.lineWidth = this.strokeWidth;
          this.ctx.lineCap = 'round';
          this.ctx.lineJoin = 'round';
          this.ctx.stroke();
        }
      }
    }
  }

  private endDrawing(): void {
    this.isDrawing = false;
    const stroke = this.strokesManager.endStroke();
    
    if (stroke) {
      this.updatePreviewRecognition();
      this.scheduleCharacterRecognition();
    }
    
    this.redraw();
  }

  private updatePreviewRecognition(): void {
    const strokes = this.strokesManager.getStrokes();
    if (strokes.length === 0) {
      this.resultValue.textContent = '-';
      this.resultConfidence.textContent = '';
      return;
    }

    const result = this.recognitionEngine.recognize(strokes);
    const displayChar = result.character || '未识别';
    this.resultValue.textContent = displayChar;
    
    if (result.character) {
      this.resultConfidence.textContent = `(匹配度: ${result.confidence}%)`;
    } else {
      this.resultConfidence.textContent = `(最佳匹配: ${result.bestMatch || '-'}, ${result.confidence}%)`;
    }

    this.resultValue.classList.remove('scale-in');
    void this.resultValue.offsetWidth;
    this.resultValue.classList.add('scale-in');
  }

  private scheduleCharacterRecognition(): void {
    this.clearCharacterTimeout();
    
    this.characterTimeout = window.setTimeout(() => {
      this.confirmCharacter();
    }, this.characterDelay);
  }

  private clearCharacterTimeout(): void {
    if (this.characterTimeout) {
      clearTimeout(this.characterTimeout);
      this.characterTimeout = null;
    }
  }

  private confirmCharacter(): void {
    const strokes = this.strokesManager.getStrokes();
    if (strokes.length === 0) return;

    const startTime = performance.now();
    const result = this.recognitionEngine.recognize(strokes);
    const endTime = performance.now();

    console.log(`识别耗时: ${(endTime - startTime).toFixed(2)}ms, 结果: ${result.character || '未识别'}`);

    this.totalCharacters++;
    
    const charStrokes = this.strokesManager.exportStrokes();
    this.historyStack.push({ strokes: charStrokes, char: result.character });
    
    if (result.character) {
      this.appendCharacter(result.character);
      this.recognizedCount++;
    }
    
    this.strokesManager.clear();
    this.redraw();
    this.updateProgress();
    
    this.resultValue.textContent = result.character || '未识别';
    this.resultConfidence.textContent = result.character 
      ? `(匹配度: ${result.confidence}%)` 
      : `(最佳匹配: ${result.bestMatch || '-'}, ${result.confidence}%)`;
  }

  private appendCharacter(char: string): void {
    const textarea = this.textPreview;
    const cursorPos = textarea.selectionStart;
    const text = textarea.value;
    
    const newText = text.substring(0, cursorPos) + char + text.substring(textarea.selectionEnd);
    textarea.value = newText;
    
    const newPos = cursorPos + char.length;
    textarea.setSelectionRange(newPos, newPos);
    
    this.startHighlightAnimation();
  }

  private startHighlightAnimation(): void {
    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer);
    }
    
    this.textPreview.classList.add('highlight-char');
    
    this.highlightTimer = window.setTimeout(() => {
      this.textPreview.classList.remove('highlight-char');
    }, 2000);
  }

  private deleteLastChar(): void {
    const textarea = this.textPreview;
    const cursorPos = textarea.selectionStart;
    
    if (cursorPos > 0) {
      const text = textarea.value;
      const newText = text.substring(0, cursorPos - 1) + text.substring(textarea.selectionEnd);
      textarea.value = newText;
      
      const newPos = cursorPos - 1;
      textarea.setSelectionRange(newPos, newPos);
    }
  }

  private undo(): void {
    const currentStrokes = this.strokesManager.getStrokes();
    
    if (currentStrokes.length > 0) {
      this.strokesManager.undo();
      this.updatePreviewRecognition();
      this.redraw();
      return;
    }
    
    if (this.historyStack.length > 0) {
      const lastEntry = this.historyStack.pop()!;
      
      this.strokesManager.clear();
      for (const stroke of lastEntry.strokes) {
        this.strokesManager.getStrokes().push(stroke);
      }
      
      if (lastEntry.char) {
        this.recognizedCount--;
        const text = this.textPreview.value;
        this.textPreview.value = text.slice(0, -1);
      }
      
      this.totalCharacters--;
      this.updateProgress();
      this.updatePreviewRecognition();
      this.redraw();
    }
  }

  private clear(): void {
    this.strokesManager.clear();
    this.historyStack = [];
    this.totalCharacters = 0;
    this.recognizedCount = 0;
    this.textPreview.value = '';
    this.resultValue.textContent = '-';
    this.resultConfidence.textContent = '';
    this.clearCharacterTimeout();
    this.updateProgress();
    this.redraw();
  }

  private exportTxt(): void {
    const text = this.textPreview.value;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'handwriting-text.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private updateProgress(): void {
    const percentage = this.totalCharacters > 0 
      ? (this.recognizedCount / this.totalCharacters) * 100 
      : 0;
    
    this.progressBar.style.width = `${percentage}%`;
    this.progressText.textContent = `${this.recognizedCount} / ${this.totalCharacters}`;
  }

  private redraw(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);

    const strokes = this.strokesManager.getStrokes();
    for (const stroke of strokes) {
      this.drawStroke(stroke);
    }
  }

  private drawStroke(stroke: Stroke): void {
    if (stroke.points.length < 2) return;

    this.ctx.beginPath();
    this.ctx.strokeStyle = stroke.color;
    this.ctx.lineWidth = stroke.width;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    const points = stroke.points;
    this.ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }

    this.ctx.stroke();
  }

  public setCharacterDelay(delay: number): void {
    this.characterDelay = delay;
  }
}
