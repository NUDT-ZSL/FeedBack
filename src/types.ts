export type ToolType = 'pencil' | 'rectangle' | 'circle' | 'text' | 'image';

export interface Point {
  x: number;
  y: number;
}

export interface CanvasElement {
  id: string;
  type: 'pencil' | 'rectangle' | 'circle' | 'text' | 'image';
  x: number;
  y: number;
  width?: number;
  height?: number;
  radius?: number;
  points?: Point[];
  color: string;
  strokeWidth: number;
  text?: string;
  imageData?: string;
  rotation: number;
  layer: number;
  userId: string;
  createdAt: number;
  opacity: number;
}

export type WSMessage =
  | { type: 'join'; userId: string; timestamp: number }
  | { type: 'leave'; userId: string; timestamp: number }
  | { type: 'draw'; userId: string; element: CanvasElement; timestamp: number }
  | { type: 'update'; userId: string; elementId: string; updates: Partial<CanvasElement>; timestamp: number }
  | { type: 'delete'; userId: string; elementId: string; timestamp: number }
  | { type: 'users'; count: number; userIds: string[] }
  | { type: 'sync'; elements: CanvasElement[] };

export interface CanvasState {
  zoom: number;
  panX: number;
  panY: number;
  elements: CanvasElement[];
  selectedElementId: string | null;
  currentTool: ToolType;
}
