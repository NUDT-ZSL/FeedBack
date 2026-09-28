export interface ImageryElement {
  keyword: string;
  aliases: string[];
  category: string;
  defaultInk: number;
}

export interface ImageryMatch {
  keyword: string;
  position: number;
  lineIndex: number;
  element: ImageryElement;
  x: number;
  y: number;
  scale: number;
  inkOpacity: number;
}

export interface DrawPoint {
  x: number;
  y: number;
  pressure: number;
  timestamp: number;
}

export type BrushType = 'brush' | 'pencil' | 'spray';

export interface BrushConfig {
  type: BrushType;
  color: string;
  size: number;
}

export interface PoemData {
  title: string;
  author: string;
  content: string;
}
