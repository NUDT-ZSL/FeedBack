import { create } from 'zustand';

export type ActionType = 'dance' | 'fight' | 'flip';

export interface CharacterData {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flipY: number;
}

export interface ActionItem {
  id: string;
  characterIndex: number;
  type: ActionType;
  duration: number;
  startTime: number;
}

export const CHARACTER_NAMES = ['孙悟空', '白骨精', '铁扇公主'];
export const CHARACTER_COLORS = ['#f39c12', '#e74c3c', '#2ecc71'];

export const DEFAULT_ACTION_DURATION = 2000;
export const MIN_ACTION_DURATION = 500;
export const MAX_ACTION_DURATION = 10000;

export const getActionEnd = (action: ActionItem): number => action.startTime + action.duration;

export const getTotalDuration = (queue: ActionItem[]): number =>
  queue.reduce((max, action) => Math.max(max, getActionEnd(action)), 0);

export const getActionProgress = (action: ActionItem, time: number): number => {
  if (action.duration <= 0) return 0;
  if (time < action.startTime || time >= getActionEnd(action)) return 0;
  return (time - action.startTime) / action.duration;
};

interface PoseDelta {
  dx: number;
  dy: number;
  scaleFactor: number;
  rotation: number;
  flipY: number;
}

const ACTION_POSES: Record<ActionType, (progress: number) => PoseDelta> = {
  dance: (t) => ({
    dx: Math.sin(t * Math.PI * 4) * 20,
    dy: 0,
    scaleFactor: 1 + Math.sin(t * Math.PI * 4) * 0.1,
    rotation: 0,
    flipY: 0,
  }),
  fight: (t) => ({
    dx: Math.sin(t * Math.PI * 2) * 10,
    dy: Math.cos(t * Math.PI * 2) * 5,
    scaleFactor: 1,
    rotation: t * 360,
    flipY: 0,
  }),
  flip: (t) => ({
    dx: 0,
    dy: -Math.sin(t * Math.PI) * 60,
    scaleFactor: 1,
    rotation: t * 360,
    flipY: t < 0.5 ? t * 2 : (1 - t) * 2,
  }),
};

// 重叠合成规则：同一角色在同一时刻被多个动作覆盖时，各动作按队列顺序叠加——
// 水平/垂直位移相加，缩放系数相乘，旋转角度相加，翻转程度取最大值；
// 每个角色独立合成，不同角色的动作互不干扰。无动作覆盖的角色返回 null（保持基准姿态）。
export const computePoses = (
  queue: ActionItem[],
  characters: CharacterData[],
  time: number
): (CharacterData | null)[] =>
  characters.map((base, characterIndex) => {
    const active = queue.filter(
      (action) =>
        action.characterIndex === characterIndex &&
        time >= action.startTime &&
        time < getActionEnd(action)
    );
    if (active.length === 0) return null;

    let x = base.x;
    let y = base.y;
    let scale = base.scale;
    let rotation = 0;
    let flipY = 0;

    for (const action of active) {
      const progress = getActionProgress(action, time);
      const delta = ACTION_POSES[action.type](progress);
      x += delta.dx;
      y += delta.dy;
      scale *= delta.scaleFactor;
      rotation += delta.rotation;
      flipY = Math.max(flipY, delta.flipY);
    }

    return { x, y, scale, rotation, flipY };
  });

const sortByStartTime = (queue: ActionItem[]): ActionItem[] =>
  [...queue].sort((a, b) => a.startTime - b.startTime);

interface StoreState {
  lightSource: { x: number; y: number };
  selectedCharacter: number | null;
  characters: CharacterData[];
  animPoses: (CharacterData | null)[];
  actionQueue: ActionItem[];
  isPlaying: boolean;
  currentTime: number;
  setLightSource: (x: number, y: number) => void;
  setSelectedCharacter: (index: number | null) => void;
  setCharacterPosition: (index: number, x: number, y: number) => void;
  setCharacterScale: (index: number, scale: number) => void;
  setAnimPoses: (poses: (CharacterData | null)[]) => void;
  addAction: (characterIndex: number, type: ActionType) => void;
  removeAction: (id: string) => void;
  reorderActions: (fromIndex: number, toIndex: number) => void;
  updateActionTiming: (id: string, patch: { startTime?: number; duration?: number }) => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
}

const createInitialCharacters = (): CharacterData[] => [
  { x: 0, y: 0, scale: 1.0, rotation: 0, flipY: 0 },
  { x: 0, y: 0, scale: 1.0, rotation: 0, flipY: 0 },
  { x: 0, y: 0, scale: 1.0, rotation: 0, flipY: 0 },
];

const createEmptyAnimPoses = (): (CharacterData | null)[] => [null, null, null];

export const useStore = create<StoreState>((set) => ({
  lightSource: { x: 80, y: 80 },
  selectedCharacter: null,
  characters: createInitialCharacters(),
  animPoses: createEmptyAnimPoses(),
  actionQueue: [],
  isPlaying: false,
  currentTime: 0,

  setLightSource: (x, y) => set({ lightSource: { x, y } }),

  setSelectedCharacter: (index) => set({ selectedCharacter: index }),

  setCharacterPosition: (index, x, y) =>
    set((state) => {
      const newCharacters = [...state.characters];
      newCharacters[index] = { ...newCharacters[index], x, y };
      const newAnimPoses = [...state.animPoses];
      if (!state.isPlaying) newAnimPoses[index] = null;
      return { characters: newCharacters, animPoses: newAnimPoses };
    }),

  setCharacterScale: (index, scale) =>
    set((state) => {
      const newCharacters = [...state.characters];
      newCharacters[index] = { ...newCharacters[index], scale };
      const newAnimPoses = [...state.animPoses];
      if (!state.isPlaying) newAnimPoses[index] = null;
      return { characters: newCharacters, animPoses: newAnimPoses };
    }),

  setAnimPoses: (poses) => set({ animPoses: poses }),

  addAction: (characterIndex, type) =>
    set((state) => {
      const newAction: ActionItem = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        characterIndex,
        type,
        duration: DEFAULT_ACTION_DURATION,
        startTime: getTotalDuration(state.actionQueue),
      };
      return { actionQueue: sortByStartTime([...state.actionQueue, newAction]) };
    }),

  removeAction: (id) =>
    set((state) => ({
      actionQueue: state.actionQueue.filter((a) => a.id !== id),
    })),

  reorderActions: (fromIndex, toIndex) =>
    set((state) => {
      const newQueue = [...state.actionQueue];
      const [removed] = newQueue.splice(fromIndex, 1);
      newQueue.splice(toIndex, 0, removed);
      let cursor = 0;
      const relayout = newQueue.map((action) => {
        const next = { ...action, startTime: cursor };
        cursor += action.duration;
        return next;
      });
      return { actionQueue: relayout };
    }),

  updateActionTiming: (id, patch) =>
    set((state) => {
      const newQueue = state.actionQueue.map((action) => {
        if (action.id !== id) return action;
        const duration =
          patch.duration !== undefined
            ? Math.min(MAX_ACTION_DURATION, Math.max(MIN_ACTION_DURATION, patch.duration))
            : action.duration;
        const startTime =
          patch.startTime !== undefined ? Math.max(0, patch.startTime) : action.startTime;
        return { ...action, duration, startTime };
      });
      return { actionQueue: sortByStartTime(newQueue) };
    }),

  setIsPlaying: (playing) => set({ isPlaying: playing }),

  setCurrentTime: (time) => set({ currentTime: time }),
}));
