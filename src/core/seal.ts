import { v4 as uuidv4 } from 'uuid';
import type {
  CarvingStyle,
  HistoryItem,
  Position,
  SealDocument,
  SealFont,
  SealSize,
  SealState,
  StampRecord,
  StrokeData,
} from '../types/index.ts';
import { SEAL_POSITIONS } from '../types/index.ts';
import { generateSealPath } from '../utils/zhuanshuPaths.ts';

export const MAX_HISTORY = 15;
export const MAX_CHARACTERS = 4;
export const DRAG_LIMIT = 20;
export const SPRING_FACTOR = 0.3;

export const DEFAULT_FONT: SealFont = 'xiaozhuan';
export const DEFAULT_SIZE: SealSize = '1cun';
export const DEFAULT_STYLE: CarvingStyle = 'yangke';

export const createEmptySealState = (): SealState => ({
  font: DEFAULT_FONT,
  size: DEFAULT_SIZE,
  style: DEFAULT_STYLE,
  characters: [],
  strokes: [],
});

export const createSealDocument = (name: string): SealDocument => ({
  id: uuidv4(),
  name,
  state: createEmptySealState(),
  history: [{ state: createEmptySealState(), actionName: '新建印章' }],
  historyIndex: 0,
});

export const cloneSealState = (state: SealState): SealState =>
  JSON.parse(JSON.stringify(state)) as SealState;

export const buildStrokes = (characters: string[], font: SealFont): StrokeData[] =>
  characters.map((char, index) => {
    const anchor = SEAL_POSITIONS[index % SEAL_POSITIONS.length];
    return {
      id: uuidv4(),
      char,
      position: { x: 0, y: 0 },
      originalPosition: { x: anchor.x, y: anchor.y },
      path: generateSealPath(char, font),
      bounds: { width: 0.5, height: 0.5 },
      tempOffset: { x: 0, y: 0 },
      springVelocity: { x: 0, y: 0 },
    };
  });

export const pushHistory = (
  doc: SealDocument,
  actionName: string,
  nextState: SealState,
): SealDocument => {
  const entry: HistoryItem = { state: cloneSealState(nextState), actionName };
  const history = [...doc.history.slice(0, doc.historyIndex + 1), entry];
  const trimmed = history.length > MAX_HISTORY ? history.slice(history.length - MAX_HISTORY) : history;
  return { ...doc, state: cloneSealState(nextState), history: trimmed, historyIndex: trimmed.length - 1 };
};

export const undoSeal = (doc: SealDocument): SealDocument => {
  if (!canUndo(doc)) return doc;
  const target = doc.history[doc.historyIndex - 1];
  return { ...doc, state: cloneSealState(target.state), historyIndex: doc.historyIndex - 1 };
};

export const redoSeal = (doc: SealDocument): SealDocument => {
  if (!canRedo(doc)) return doc;
  const target = doc.history[doc.historyIndex + 1];
  return { ...doc, state: cloneSealState(target.state), historyIndex: doc.historyIndex + 1 };
};

export const canUndo = (doc: SealDocument): boolean => doc.historyIndex > 0;
export const canRedo = (doc: SealDocument): boolean => doc.historyIndex < doc.history.length - 1;

export const clampOffset = (offset: Position): Position => {
  const distance = Math.hypot(offset.x, offset.y);
  if (distance <= DRAG_LIMIT || distance === 0) return { ...offset };
  const scale = DRAG_LIMIT / distance;
  return { x: offset.x * scale, y: offset.y * scale };
};

export const applyStrokeDrag = (
  strokes: StrokeData[],
  strokeId: string,
  offset: Position,
): StrokeData[] => {
  const clamped = clampOffset(offset);
  return strokes.map((stroke) => {
    if (stroke.id === strokeId) {
      return { ...stroke, tempOffset: clamped };
    }
    return {
      ...stroke,
      tempOffset: { x: clamped.x * SPRING_FACTOR, y: clamped.y * SPRING_FACTOR },
    };
  });
};

export const commitStrokeDrag = (strokes: StrokeData[], strokeId: string): StrokeData[] =>
  strokes.map((stroke) => ({
    ...stroke,
    position:
      stroke.id === strokeId
        ? {
            x: stroke.position.x + stroke.tempOffset.x,
            y: stroke.position.y + stroke.tempOffset.y,
          }
        : stroke.position,
    tempOffset: { x: 0, y: 0 },
    springVelocity: { x: 0, y: 0 },
  }));

export const setCharactersOnState = (state: SealState, characters: string[]): SealState => {
  const next = characters.slice(0, MAX_CHARACTERS);
  return { ...state, characters: next, strokes: buildStrokes(next, state.font) };
};

export const setFontOnState = (state: SealState, font: SealFont): SealState => ({
  ...state,
  font,
  strokes: buildStrokes(state.characters, font),
});

export const setStyleOnState = (state: SealState, style: CarvingStyle): SealState => ({
  ...state,
  style,
});

export const setSizeOnState = (state: SealState, size: SealSize): SealState => ({
  ...state,
  size,
});

export const createStampRecord = (sealId: string, state: SealState): StampRecord => ({
  id: uuidv4(),
  sealId,
  snapshot: cloneSealState(state),
  createdAt: Date.now(),
});
