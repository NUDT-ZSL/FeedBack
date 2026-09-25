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

// The wire protocol moved to the versioned incremental sync protocol in
// src/sync/protocol.ts. Re-exported here for backwards compatibility of
// existing imports.
export type { ClientMessage, ServerMessage, Op, VersionedOp, Clock } from './sync/protocol';

export interface CanvasState {
  zoom: number;
  panX: number;
  panY: number;
  elements: CanvasElement[];
  selectedElementId: string | null;
  currentTool: ToolType;
}
