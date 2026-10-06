import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, History, AlertTriangle, Trophy } from 'lucide-react';
import { useGameStore } from '@/store/gameStore';
import { buildMatchHistory } from '@/lib/persistence';
import type { RoundRecord, Score } from '@/types';

interface MatchHistoryProps {
  open: boolean;
  onClose: () => void;
}

const ScoreCells: React.FC<{ score: Score; highlight?: boolean }> = ({ score, highlight }) => (
  <div className={`grid grid-cols-4 gap-1 text-center text-xs ${highlight ? 'font-bold' : ''}`}>
    <span>{score.color}</span>
    <span>{score.duration}</span>
    <span>{score.adhesion}</span>
    <span className="text-amber-700 font-bold">{score.total}</span>
  </div>
);

const CandidateCard: React.FC<{
  record: RoundRecord;
  onKeep: () => void;
}> = ({ record, onKeep }) => (
  <div className="bg-amber-100/70 border border-amber-300 rounded-lg p-3 space-y-2">
    <div className="flex justify-between text-[11px] font-kai text-amber-700">
      <span>记录于 {new Date(record.updatedAt).toLocaleString('zh-CN')}</span>
    </div>
    <div className="grid grid-cols-[3rem_1fr] items-center gap-2 text-xs font-kai text-amber-900">
      <span>您</span>
      <ScoreCells score={record.userScore} />
      <span>AI</span>
      <ScoreCells score={record.aiScore} />
    </div>
    <button
      className="interactive-btn w-full py-1.5 rounded-md bg-amber-600 text-white text-xs font-kai"
      onClick={onKeep}
    >
      保留此记录
    </button>
  </div>
);

export const MatchHistory: React.FC<MatchHistoryProps> = ({ open, onClose }) => {
  const roundRecords = useGameStore(state => state.roundRecords);
  const resolveConflict = useGameStore(state => state.resolveConflict);
  const history = buildMatchHistory(roundRecords);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="relative bg-amber-50 rounded-2xl p-6 max-w-2xl w-full max-h-[85vh] flex flex-col"
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-amber-200/50 transition-colors"
              onClick={onClose}
            >
              <X size={20} className="text-amber-900" />
            </button>

            <div className="flex items-center gap-2 mb-1">
              <History size={20} className="text-amber-900" />
              <h2 className="font-title text-2xl text-amber-900">对局记录</h2>
            </div>
            <p className="text-xs font-kai text-amber-700 mb-4 flex items-center gap-1">
              <Trophy size={12} />
              累计战绩：{history.totals.wins} 胜 / {history.totals.losses} 负 / {history.totals.draws} 平
            </p>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {history.conflicts.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-red-800 font-kai text-sm">
                    <AlertTriangle size={16} />
                    检测到 {history.conflicts.length} 个回合存在冲突记录，请选择要保留的结果
                  </div>
                  {history.conflicts.map(conflict => (
                    <div key={conflict.round} className="space-y-2">
                      <div className="text-sm font-kai text-amber-900 font-bold">
                        第 {conflict.round} 回合（{conflict.candidates.length} 条冲突记录）
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {conflict.candidates.map(candidate => (
                          <CandidateCard
                            key={candidate.id}
                            record={candidate}
                            onKeep={() => resolveConflict(conflict.round, candidate.id)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {history.rounds.length === 0 && history.conflicts.length === 0 ? (
                <div className="text-center py-12 text-amber-700 font-kai text-sm">
                  还没有对局记录，完成一轮斗茶后自动记录
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[3.5rem_1fr_1fr_3rem] gap-2 text-[11px] font-kai text-amber-700 px-3">
                    <span>回合</span>
                    <div>
                      <div className="mb-0.5">您（色/持/咬/总）</div>
                    </div>
                    <div>
                      <div className="mb-0.5">AI（色/持/咬/总）</div>
                    </div>
                    <span className="text-center">结果</span>
                  </div>
                  {history.rounds.map(entry => (
                    <div
                      key={entry.id}
                      className={`grid grid-cols-[3.5rem_1fr_1fr_3rem] gap-2 items-center rounded-lg px-3 py-2 text-sm font-kai text-amber-900 ${
                        entry.winner === 'user'
                          ? 'bg-amber-200/60'
                          : entry.winner === 'ai'
                          ? 'bg-amber-100/40'
                          : 'bg-amber-100/70'
                      }`}
                    >
                      <span className="font-bold">第{entry.round}回</span>
                      <ScoreCells score={entry.userScore} highlight={entry.winner === 'user'} />
                      <ScoreCells score={entry.aiScore} highlight={entry.winner === 'ai'} />
                      <span
                        className={`text-center font-bold ${
                          entry.winner === 'user'
                            ? 'text-red-700'
                            : entry.winner === 'ai'
                            ? 'text-amber-500'
                            : 'text-amber-700'
                        }`}
                      >
                        {entry.winner === 'user' ? '胜' : entry.winner === 'ai' ? '负' : '平'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
