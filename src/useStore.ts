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

interface StoreState {
  lightSource: { x: number; y: number };
  selectedCharacter: number | null;
  characters: CharacterData[];
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
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  resetCharacterAnim: (index: number) => void;
}

const createInitialCharacters = (): CharacterData[] => [
  { x: 0, y: 0, scale: 1.0, rotation: 0, flipY: 0 },
  { x: 0, y: 0, scale: 1.0, rotation: 0, flipY: 0 },
  { x: 0, y: 0, scale: 1.0, rotation: 0, flipY: 0 },
];

export const useStore = create<StoreState>((set) => ({
  lightSource: { x: 80, y: 80 },
  selectedCharacter: null,
  characters: createInitialCharacters(),
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

  addAction: (characterIndex, type) =>
    set((state) => {
      const newAction: ActionItem = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        characterIndex,
        type,
        duration: 2000,
        startTime: state.currentTime,
      };
      return { actionQueue: [...state.actionQueue, newAction] };
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
      return { actionQueue: newQueue };
    }),

  setIsPlaying: (playing) => set({ isPlaying: playing }),

  setCurrentTime: (time) => set({ currentTime: time }),
}));
