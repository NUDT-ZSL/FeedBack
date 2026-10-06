import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Swords, AlertTriangle } from 'lucide-react';
import { useGameStore } from '@/store/gameStore';
import { cumulativeStats, computeMatchStats } from '@/lib/persistence';
import type { MatchRecord } from '@/types';

interface MatchHistoryProps {
  open: boolean;
  onClose: () => void;
}

const winnerLabel: Record<MatchRecord['winner'], string> = {
  user: '胜',
  ai: '负',
  draw: '平',
};

const winnerColor: Record<MatchRecord['winner'], string> = {
  user: 'text-green-700',
  ai: 'text-red-700',
  draw: 'text-amber-700',
};

function ScoreCells({ record }: { record: MatchRecord }) {
  return (
    <>
      <td className="px-2 py-2 text-center">
        {record.userScore.color}/{record.userScore.duration}/{record.userScore.adhesion}
        <span className="ml-1 font-bold text-amber-900">{record.userScore.total}</span>
      </td>
      <td className="px-2 py-2 text-center">
        {record.aiScore.color}/{record.aiScore.duration}/{record.aiScore.adhesion}
        <span className="ml-1 font-bold text-amber-900">{record.aiScore.total}</span>
      </td>
    </>
  );
}

export const MatchHistory: React.FC<MatchHistoryProps> = ({ open, onClose }) => {
  const records = useGameStore((state) => state.records);
  const adjudicateRecord = useGameStore((state) => state.adjudicateRecord);

  const stats = computeMatchStats(records);
  const cumulative = cumulativeStats(records);
  const settled = records.filter((r) => r.conflictKey === null);
  const conflictGroups = new Map<string, MatchRecord[]>();
  records
    .filter((r) => r.conflictKey !== null)
    .forEach((r) => {
      const key = r.conflictKey as string;
      const group = conflictGroups.get(key);
      if (group) group.push(r);
      else conflictGroups.set(key, [r]);
    });

  const cumulativeForRound = (round: number) => {
    const idx = settled.findIndex((r) => r.round === round);
    return idx >= 0 ? cumulative[idx] : null;
  };

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
            className="relative bg-amber-50 rounded-2xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto"
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
              <Swords size={22} className="text-amber-800" />
              <h3 className="font-title text-2xl text-amber-900">对局记录</h3>
            </div>
            <p className="text-sm font-kai text-amber-700 mb-4">
              累计战绩：
              <span className="text-green-700 font-bold">{stats.wins} 胜</span>
              {' / '}
              <span className="text-red-700 font-bold">{stats.losses} 负</span>
              {' / '}
              <span className="text-amber-700 font-bold">{stats.draws} 平</span>
              {conflictGroups.size > 0 && (
                <span className="ml-2 text-red-600">（{conflictGroups.size} 个回合存在冲突待裁决）</span>
              )}
            </p>

            {records.length === 0 ? (
              <div className="text-center py-10 font-kai text-amber-700">
                <div className="text-5xl mb-3 opacity-30">📜</div>
                暂无对局记录，完成一局斗茶后自动记录
              </div>
            ) : (
              <table className="w-full text-sm font-kai text-amber-800">
                <thead>
                  <tr className="border-b border-amber-900/20 text-amber-900">
                    <th className="px-2 py-2 text-left">回合</th>
                    <th className="px-2 py-2 text-center">您（色/持/咬/总）</th>
                    <th className="px-2 py-2 text-center">AI（色/持/咬/总）</th>
                    <th className="px-2 py-2 text-center">胜负</th>
                    <th className="px-2 py-2 text-center">累计</th>
                  </tr>
                </thead>
                <tbody>
                  {settled.map((record) => {
                    const cum = cumulativeForRound(record.round);
                    return (
                      <tr key={record.id} className="border-b border-amber-900/10">
                        <td className="px-2 py-2">第 {record.round} 回合</td>
                        <ScoreCells record={record} />
                        <td className={`px-2 py-2 text-center font-bold ${winnerColor[record.winner]}`}>
                          {winnerLabel[record.winner]}
                        </td>
                        <td className="px-2 py-2 text-center text-xs">
                          {cum ? `${cum.wins}胜${cum.losses}负${cum.draws}平` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {conflictGroups.size > 0 && (
              <div className="mt-6">
                <h4 className="font-title text-lg text-red-800 flex items-center gap-2 mb-3">
                  <AlertTriangle size={18} />
                  冲突记录待裁决
                </h4>
                {Array.from(conflictGroups.entries()).map(([key, group]) => (
                  <div key={key} className="mb-4 rounded-lg border border-red-300 bg-red-50/60 p-3">
                    <p className="text-sm font-kai text-red-800 mb-2">
                      第 {group[0].round} 回合收到 {group.length} 条不同结果，请选择保留一条：
                    </p>
                    <div className="space-y-2">
                      {group.map((record, idx) => (
                        <div
                          key={record.id}
                          className="flex items-center justify-between gap-3 rounded-md bg-amber-50 px-3 py-2 text-sm font-kai text-amber-900"
                        >
                          <span>
                            方案{idx + 1}：您 {record.userScore.total} 分（{record.userScore.color}/
                            {record.userScore.duration}/{record.userScore.adhesion}） vs AI{' '}
                            {record.aiScore.total} 分（{record.aiScore.color}/{record.aiScore.duration}/
                            {record.aiScore.adhesion}）· {winnerLabel[record.winner]}
                          </span>
                          <button
                            className="interactive-btn shrink-0 rounded-md bg-amber-600 px-3 py-1 text-white text-xs"
                            onClick={() => adjudicateRecord(key, record.id)}
                          >
                            保留此条
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
