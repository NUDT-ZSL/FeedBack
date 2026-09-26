import { StrokesManager } from './strokes-manager';
import { RecognitionEngine } from './recognition-engine';
import { UIController } from './ui-controller';

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('drawing-canvas') as HTMLCanvasElement;
  
  if (!canvas) {
    console.error('Canvas element not found');
    return;
  }

  const strokesManager = new StrokesManager({ maxUndoSteps: 30 });
  const recognitionEngine = new RecognitionEngine();
  const uiController = new UIController(canvas, strokesManager, recognitionEngine);

  console.log('手写笔迹识别应用已启动');
  console.log('快捷键: Ctrl+Z 撤销, Backspace 删除字符');
});
