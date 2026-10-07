import { create } from 'zustand';
import type { CoinSide, DivinationRecord, Yao } from '@/types';
import { flipSingleCoin, determineYaoType } from '@/utils/coinFlip';
import {
  deriveBianBinary,
  getMovingPositions,
  yaoArrayToBinary,
} from '@/utils/hexagramCalc';
import { createRecordId, loadRecords, saveRecords, sortRecords } from '@/utils/archive';

const FLIP_DURATION_MS = 600;

export interface CoinDisplay {
  face: CoinSide;
  rotation: number;
}

interface DivinationStore {
  /** 当前卦的已摇出爻（0-6，索引 0 为初爻） */
  yaos: Yao[];
  /** 本次摇动的三枚铜钱 */
  coins: CoinDisplay[];
  /** 铜钱是否正在翻转 */
  flipping: boolean;
  /** 当前卦是否已成（满六爻） */
  complete: boolean;
  /** 刚完成卦对应的归档记录 ID */
  currentRecordId: string | null;
  /** 归档记录（倒序） */
  records: DivinationRecord[];
  /** 当前打开的详情记录 ID */
  selectedId: string | null;

  cast: () => void;
  resetCast: () => void;
  deleteRecord: (id: string) => void;
  clearRecords: () => void;
  updateQuestion: (id: string, question: string) => void;
  selectRecord: (id: string | null) => void;
}

function randomCoins(): CoinDisplay[] {
  return Array.from({ length: 3 }, () => ({
    face: flipSingleCoin(),
    rotation: 360 + Math.floor(Math.random() * 360) * 2,
  }));
}

export const useDivinationStore = create<DivinationStore>((set, get) => ({
  yaos: [],
  coins: [],
  flipping: false,
  complete: false,
  currentRecordId: null,
  records: loadRecords(),
  selectedId: null,

  cast: () => {
    const { yaos, flipping, complete } = get();
    if (flipping || complete || yaos.length >= 6) return;

    const coins = randomCoins();
    set({ flipping: true, coins });

    window.setTimeout(() => {
      const coinSides = coins.map((c) => c.face) as [CoinSide, CoinSide, CoinSide];
      const result = determineYaoType(coinSides);
      const position = (get().yaos.length + 1) as Yao['position'];
      const yao: Yao = { position, coins: coinSides, ...result };
      const nextYaos = [...get().yaos, yao];

      if (nextYaos.length === 6) {
        const createdAt = Date.now();
        const benBinary = yaoArrayToBinary(nextYaos);
        const movingPositions = getMovingPositions(nextYaos);
        const record: DivinationRecord = {
          id: createRecordId(createdAt),
          createdAt,
          question: '',
          yaos: nextYaos,
          benBinary,
          bianBinary: deriveBianBinary(benBinary, movingPositions),
          movingPositions,
        };
        const records = sortRecords([record, ...get().records]);
        saveRecords(records);
        set({
          yaos: nextYaos,
          flipping: false,
          complete: true,
          currentRecordId: record.id,
          records,
        });
      } else {
        set({ yaos: nextYaos, flipping: false });
      }
    }, FLIP_DURATION_MS);
  },

  resetCast: () => {
    set({ yaos: [], coins: [], flipping: false, complete: false, currentRecordId: null });
  },

  deleteRecord: (id) => {
    const records = get().records.filter((r) => r.id !== id);
    saveRecords(records);
    set((state) => ({
      records,
      selectedId: state.selectedId === id ? null : state.selectedId,
      currentRecordId: state.currentRecordId === id ? null : state.currentRecordId,
    }));
  },

  clearRecords: () => {
    saveRecords([]);
    set({ records: [], selectedId: null, currentRecordId: null });
  },

  updateQuestion: (id, question) => {
    const records = get().records.map((r) => (r.id === id ? { ...r, question } : r));
    saveRecords(records);
    set({ records });
  },

  selectRecord: (id) => {
    set({ selectedId: id });
  },
}));
