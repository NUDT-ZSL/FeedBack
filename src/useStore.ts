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

export const MIN_ACTION_DURATION = 500;
export const MAX_ACTION_DURATION = 10000;
export const DEFAULT_ACTION_DURATION = 2000;

/** 时间轴总跨度：所有动作 [startTime, startTime+duration) 的最右端。 */
export const getTimelineTotal = (queue: ActionItem[]): number =>
  queue.reduce((max, a) => Math.max(max, a.startTime + a.duration), 0);

/** 同一角色时间区间重叠时返回 true（用于界面标注“叠加”）。 */
export const hasCharacterOverlap = (queue: ActionItem[], action: ActionItem): boolean =>
  queue.some(
    (other) =>
      other.id !== action.id &&
      other.characterIndex === action.characterIndex &&
      other.startTime < action.startTime + action.duration &&
      action.startTime < other.startTime + other.duration
  );

interface StoreState {
  lightSource: { x: number; y: number };
  selectedCharacter: number | null;
  characters: CharacterData[];
  baseCharacters: CharacterData[] | null;
  actionQueue: ActionItem[];
  isPlaying: boolean;
  currentTime: number;
  setLightSource: (x: number, y: number) => void;
  setSelectedCharacter: (index: number | null) => void;
  setCharacterPosition: (index: number, x: number, y: number) => void;
  setCharacterScale: (index: number, scale: number) => void;
  setCharacterRotation: (index: number, rotation: number) => void;
  setCharacterFlipY: (index: number, flipY: number) => void;
  addAction: (characterIndex: number, type: ActionType) => void;
  removeAction: (id: string) => void;
  reorderActions: (fromIndex: number, toIndex: number) => void;
  setActionDuration: (id: string, duration: number) => void;
  clearQueue: () => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  captureBase: () => void;
  resetPlayback: () => void;
  resetCharacterAnim: (index: number) => void;
}

const createInitialCharacters = (): CharacterData[] => [
  { x: 0, y: 0, scale: 1.0, rotation: 0, flipY: 0 },
  { x: 0, y: 0, scale: 1.0, rotation: 0, flipY: 0 },
  { x: 0, y: 0, scale: 1.0, rotation: 0, flipY: 0 },
];

/** 播放复位：进度归零、停止播放、角色恢复开演前姿态（无基准时仅清零旋转/翻转）。 */
const playbackReset = (state: Pick<StoreState, 'baseCharacters' | 'characters'>) => ({
  isPlaying: false,
  currentTime: 0,
  characters: state.baseCharacters
    ? state.baseCharacters.map((c) => ({ ...c }))
    : state.characters.map((c) => ({ ...c, rotation: 0, flipY: 0 })),
  baseCharacters: null as CharacterData[] | null,
});

export const useStore = create<StoreState>((set) => ({
  lightSource: { x: 80, y: 80 },
  selectedCharacter: null,
  characters: createInitialCharacters(),
  baseCharacters: null,
  actionQueue: [],
  isPlaying: false,
  currentTime: 0,

  setLightSource: (x, y) => set({ lightSource: { x, y } }),

  setSelectedCharacter: (index) => set({ selectedCharacter: index }),

  setCharacterPosition: (index, x, y) =>
    set((state) => {
      const newCharacters = [...state.characters];
      newCharacters[index] = { ...newCharacters[index], x, y };
      return { characters: newCharacters };
    }),

  setCharacterScale: (index, scale) =>
    set((state) => {
      const newCharacters = [...state.characters];
      newCharacters[index] = { ...newCharacters[index], scale };
      return { characters: newCharacters };
    }),

  setCharacterRotation: (index, rotation) =>
    set((state) => {
      const newCharacters = [...state.characters];
      newCharacters[index] = { ...newCharacters[index], rotation };
      return { characters: newCharacters };
    }),

  setCharacterFlipY: (index, flipY) =>
    set((state) => {
      const newCharacters = [...state.characters];
      newCharacters[index] = { ...newCharacters[index], flipY };
      return { characters: newCharacters };
    }),

  resetCharacterAnim: (index) =>
    set((state) => {
      const newCharacters = [...state.characters];
      newCharacters[index] = { ...newCharacters[index], rotation: 0, flipY: 0 };
      return { characters: newCharacters };
    }),

  // 新动作默认追加到时间轴末尾（顺序编排），时长可再单独调整。
  addAction: (characterIndex, type) =>
    set((state) => {
      const newAction: ActionItem = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        characterIndex,
        type,
        duration: DEFAULT_ACTION_DURATION,
        startTime: getTimelineTotal(state.actionQueue),
      };
      return { actionQueue: [...state.actionQueue, newAction] };
    }),

  // 删除不改变其余动作的绝对起止时刻，播放位置保持在同一时间轴坐标上；
  // 队列清空时整体复位到初始状态。
  removeAction: (id) =>
    set((state) => {
      const newQueue = state.actionQueue.filter((a) => a.id !== id);
      if (newQueue.length === 0) {
        return { actionQueue: [], ...playbackReset(state) };
      }
      const total = getTimelineTotal(newQueue);
      const currentTime = total > 0 ? state.currentTime % total : 0;
      return { actionQueue: newQueue, currentTime };
    }),

  // 调整顺序后按新顺序依次紧凑重排（保留各自时长），并把当前播放进度
  // 映射到“正在播放的那个动作”的新位置，保持其已播比例不变。
  reorderActions: (fromIndex, toIndex) =>
    set((state) => {
      const queue = [...state.actionQueue];
      const [moved] = queue.splice(fromIndex, 1);
      queue.splice(toIndex, 0, moved);

      const oldTotal = getTimelineTotal(state.actionQueue);
      const relative = oldTotal > 0 ? state.currentTime % oldTotal : 0;
      const active = state.actionQueue.find(
        (a) => relative >= a.startTime && relative < a.startTime + a.duration
      );

      let cursor = 0;
      const repacked = queue.map((a) => {
        const next = { ...a, startTime: cursor };
        cursor += a.duration;
        return next;
      });

      let currentTime: number;
      if (active) {
        const fraction = (relative - active.startTime) / active.duration;
        const relocated = repacked.find((a) => a.id === active.id)!;
        currentTime = relocated.startTime + fraction * relocated.duration;
      } else {
        const newTotal = getTimelineTotal(repacked);
        currentTime = newTotal > 0 ? relative % newTotal : 0;
      }
      return { actionQueue: repacked, currentTime };
    }),

  // 修改时长只影响该动作自身，其余动作起止时刻不变（可能产生重叠或间隙，
  // 重叠时按合成规则叠加）。若该动作正在播放，保持其已播比例不变。
  setActionDuration: (id, duration) =>
    set((state) => {
      const clamped = Math.min(MAX_ACTION_DURATION, Math.max(MIN_ACTION_DURATION, duration));
      const target = state.actionQueue.find((a) => a.id === id);
      if (!target) return {};
      const newQueue = state.actionQueue.map((a) =>
        a.id === id ? { ...a, duration: clamped } : a
      );

      const oldTotal = getTimelineTotal(state.actionQueue);
      let relative = oldTotal > 0 ? state.currentTime % oldTotal : 0;
      if (
        target.duration > 0 &&
        relative >= target.startTime &&
        relative < target.startTime + target.duration
      ) {
        const fraction = (relative - target.startTime) / target.duration;
        relative = target.startTime + fraction * clamped;
      }
      const newTotal = getTimelineTotal(newQueue);
      const currentTime = newTotal > 0 ? relative % newTotal : 0;
      return { actionQueue: newQueue, currentTime };
    }),

  clearQueue: () =>
    set((state) => ({ actionQueue: [], ...playbackReset(state) })),

  setIsPlaying: (playing) => set({ isPlaying: playing }),

  setCurrentTime: (time) => set({ currentTime: time }),

  // 开演时记录各角色的基准姿态，动画始终相对基准姿态合成。
  captureBase: () =>
    set((state) =>
      state.baseCharacters
        ? {}
        : { baseCharacters: state.characters.map((c) => ({ ...c })) }
    ),

  resetPlayback: () => set((state) => playbackReset(state)),
}));
