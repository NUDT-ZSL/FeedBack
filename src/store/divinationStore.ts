import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CoinSide, DivinationRecord, YaoSnapshot } from '@/types';
import { flipSingleCoin, determineYaoType } from '@/utils/coinFlip';
import {
  buildDeduction,
  getMovingPositions,
  toSnapshot,
  yaoArrayToBinary,
} from '@/utils/hexagramCalc';
import { getHexagramByBinary } from '@/data/hexagrams';
import { playDingSound, playVibrateSound } from '@/utils/audio';

export const FLIP_DURATION_MS = 700;
const MAX_YAO = 6;

interface DivinationState {
  /** 当前卦盘已摇出的爻（索引 0 为初爻） */
  yaos: YaoSnapshot[];
  /** 铜钱是否正在翻转 */
  casting: boolean;
  /** 最近一次摇出的三枚铜钱正背（用于动画展示） */
  lastCoins: [CoinSide, CoinSide, CoinSide] | null;
  /** 刚成卦并入档的记录 ID */
  lastRecordId: string | null;
  /** 归档记录，按时间倒序（新的在前） */
  records: DivinationRecord[];
  /** 单调递增序号，保证同毫秒记录可区分 */
  seq: number;

  throwCoins: () => void;
  resetBoard: () => void;
  updateQuestion: (id: string, question: string) => void;
  deleteRecord: (id: string) => void;
  clearRecords: () => void;
}

function makeRecordId(seq: number): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `gua-${Date.now().toString(36)}-${seq}-${random}`;
}

function buildRecord(yaos: YaoSnapshot[], seq: number): DivinationRecord {
  const binary = yaoArrayToBinary(yaos);
  const movingPositions = getMovingPositions(yaos);
  const deduction = buildDeduction(binary, movingPositions);
  return {
    id: makeRecordId(seq),
    seq,
    createdAt: Date.now(),
    question: '',
    yaos,
    benGua: toSnapshot(getHexagramByBinary(binary)),
    bianGua: toSnapshot(getHexagramByBinary(deduction.changedBinary)),
    movingPositions,
    deduction,
  };
}

export const useDivinationStore = create<DivinationState>()(
  persist(
    (set, get) => ({
      yaos: [],
      casting: false,
      lastCoins: null,
      lastRecordId: null,
      records: [],
      seq: 0,

      throwCoins: () => {
        const { casting, yaos } = get();
        if (casting || yaos.length >= MAX_YAO) return;

        const coins: [CoinSide, CoinSide, CoinSide] = [
          flipSingleCoin(),
          flipSingleCoin(),
          flipSingleCoin(),
        ];
        playVibrateSound();
        set({ casting: true, lastCoins: coins });

        window.setTimeout(() => {
          const result = determineYaoType(coins);
          const current = get().yaos;
          const yao: YaoSnapshot = {
            position: current.length + 1,
            type: result.type,
            isYang: result.isYang,
            isMoving: result.isMoving,
            coins,
          };
          const nextYaos = [...current, yao];
          playDingSound();

          if (nextYaos.length === MAX_YAO) {
            const seq = get().seq + 1;
            const record = buildRecord(nextYaos, seq);
            set({
              yaos: nextYaos,
              casting: false,
              seq,
              lastRecordId: record.id,
              records: [record, ...get().records],
            });
          } else {
            set({ yaos: nextYaos, casting: false });
          }
        }, FLIP_DURATION_MS);
      },

      resetBoard: () => {
        set({ yaos: [], casting: false, lastCoins: null, lastRecordId: null });
      },

      updateQuestion: (id, question) => {
        set({
          records: get().records.map((record) =>
            record.id === id ? { ...record, question } : record,
          ),
        });
      },

      deleteRecord: (id) => {
        const { records, lastRecordId } = get();
        set({
          records: records.filter((record) => record.id !== id),
          lastRecordId: lastRecordId === id ? null : lastRecordId,
        });
      },

      clearRecords: () => {
        set({ records: [], lastRecordId: null });
      },
    }),
    {
      name: 'liuyao-archive-v1',
      partialize: (state) => ({ records: state.records, seq: state.seq }),
    },
  ),
);

/** 归档列表：时间倒序，同毫秒按序号倒序 */
export function sortRecords(records: DivinationRecord[]): DivinationRecord[] {
  return [...records].sort((a, b) => b.createdAt - a.createdAt || b.seq - a.seq);
}
