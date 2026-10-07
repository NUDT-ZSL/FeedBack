import React from 'react';
import type { Piece, FormationType, HistoryItem, SimulationResult } from './types';
import { FORMATION_NAMES, PIECE_STATS, COLORS } from './types';
import { FORMATIONS } from './formations';
import { formatHistoryText } from './GameSimulation';
import { downloadJSON, copyShareLink } from './ExportTool';

interface PanelProps {
  pieces: Piece[];
  playerFormation: FormationType | null;
  aiFormation: FormationType | null;
  playerMorale: number;
  aiMorale: number;
  result: SimulationResult | null;
  history: HistoryItem[];
  phase: string;
  onSelectFormation: (formation: FormationType) => void;
  onReset: () => void;
  onRestoreHistory: (snapshot: Piece[]) => void;
}

const Panel: React.FC<PanelProps> = ({
  pieces,
  playerFormation,
  aiFormation,
  playerMorale,
  aiMorale,
  result,
  history,
  phase,
  onSelectFormation,
  onReset,
  onRestoreHistory,
}) => {
  const playerPieces = pieces.filter((p) => p.side === 'player' && p.status === 'alive');
  const aiPieces = pieces.filter((p) => p.side === 'ai' && p.status === 'alive');

  const countByType = (side: 'player' | 'ai') => {
    const filtered = pieces.filter((p) => p.side === side && p.status === 'alive');
    return {
      infantry: filtered.filter((p) => p.type === 'infantry').length,
      archer: filtered.filter((p) => p.type === 'archer').length,
      cavalry: filtered.filter((p) => p.type === 'cavalry').length,
    };
  };

  const playerCounts = countByType('player');
  const aiCounts = countByType('ai');

  const handleDownload = () => {
    downloadJSON(pieces, playerFormation, aiFormation);
  };

  const handleCopyLink = async () => {
    const success = await copyShareLink(pieces, playerFormation, aiFormation);
    if (success) {
      alert('分享链接已复制到剪贴板！');
    } else {
      alert('复制失败，请手动复制');
    }
  };

  const isDisabled = phase !== 'idle';

  return (
    <div className="flex h-full">
      <div
        className="w-48 p-4 flex flex-col gap-4"
        style={{
          background: `linear-gradient(to right, ${COLORS.darkBrown}, transparent)`,
          borderRight: `2px solid ${COLORS.gold}`,
        }}
      >
        <div className="text-center">
          <div
            className="text-4xl mb-2"
            style={{ textShadow: `2px 2px 4px rgba(0,0,0,0.5)` }}
          >
            🚩
          </div>
          <h3
            className="font-bold mb-4"
            style={{
              fontFamily: '"Ma Shan Zheng", serif',
              color: COLORS.parchment,
              fontSize: '20px',
            }}
          >
            我方兵力
          </h3>
        </div>

        <div className="space-y-3">
          {(['infantry', 'archer', 'cavalry'] as const).map((type) => (
            <div
              key={type}
              className="flex items-center gap-3 p-2 rounded transition-transform duration-200 hover:scale-110 cursor-default"
              style={{
                backgroundColor: 'rgba(255,255,255,0.1)',
              }}
            >
              <span className="text-2xl">{PIECE_STATS[type].icon}</span>
              <div>
                <div
                  className="text-sm"
                  style={{
                    color: COLORS.parchment,
                    fontFamily: '"Ma Shan Zheng", serif',
                  }}
                >
                  {type === 'infantry' ? '步兵' : type === 'archer' ? '弓兵' : '骑兵'}
                </div>
                <div
                  className="font-bold text-xl"
                  style={{ color: COLORS.gold }}
                >
                  {playerCounts[type]}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <div
            className="text-sm mb-1"
            style={{
              color: COLORS.parchment,
              fontFamily: '"Ma Shan Zheng", serif',
            }}
          >
            士气
          </div>
          <div
            className="h-4 rounded-full overflow-hidden"
            style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
          >
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${playerMorale}%`,
                background: `linear-gradient(to right, ${COLORS.darkRed}, ${COLORS.gold})`,
              }}
            />
          </div>
          <div
            className="text-right text-sm mt-1"
            style={{ color: COLORS.gold }}
          >
            {playerMorale}%
          </div>
        </div>

        {playerFormation && (
          <div
            className="mt-2 p-2 rounded text-center"
            style={{
              backgroundColor: 'rgba(255,255,255,0.1)',
              border: `1px solid ${COLORS.gold}`,
            }}
          >
            <div
              className="text-sm"
              style={{
                color: COLORS.parchment,
                fontFamily: '"Ma Shan Zheng", serif',
              }}
            >
              当前阵型
            </div>
            <div
              className="font-bold text-lg"
              style={{
                color: COLORS.gold,
                fontFamily: '"Ma Shan Zheng", serif',
              }}
            >
              {FORMATION_NAMES[playerFormation]}
            </div>
          </div>
        )}
      </div>

      <div
        className="w-64 p-4 flex flex-col gap-4 overflow-y-auto"
        style={{
          background: `linear-gradient(to left, ${COLORS.darkBrown}, transparent)`,
          borderLeft: `2px solid ${COLORS.gold}`,
        }}
      >
        <h3
          className="font-bold text-center mb-2"
          style={{
            fontFamily: '"Ma Shan Zheng", serif',
            color: COLORS.parchment,
            fontSize: '20px',
          }}
        >
          推演控制
        </h3>

        <div className="space-y-2">
          <div
            className="text-sm mb-2"
            style={{
              color: COLORS.parchment,
              fontFamily: '"Ma Shan Zheng", serif',
            }}
          >
            选择阵法
          </div>
          {(Object.keys(FORMATIONS) as FormationType[]).map((type) => (
            <button
              key={type}
              onClick={() => onSelectFormation(type)}
              disabled={isDisabled}
              className="w-full px-4 py-2 rounded transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                width: '80px',
                height: '30px',
                backgroundColor:
                  playerFormation === type ? COLORS.lightRed : COLORS.darkRed,
                color: COLORS.parchment,
                fontFamily: '"Ma Shan Zheng", serif',
                fontSize: '14px',
                boxShadow: '2px 2px 4px rgba(0,0,0,0.3)',
              }}
              onMouseEnter={(e) => {
                if (!isDisabled) {
                  e.currentTarget.style.backgroundColor = COLORS.lightRed;
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isDisabled) {
                  e.currentTarget.style.backgroundColor =
                    playerFormation === type ? COLORS.lightRed : COLORS.darkRed;
                  e.currentTarget.style.transform = 'translateY(0)';
                }
              }}
              onMouseDown={(e) => {
                if (!isDisabled) {
                  e.currentTarget.style.transform = 'translateY(2px)';
                }
              }}
              onMouseUp={(e) => {
                if (!isDisabled) {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }
              }}
            >
              {FORMATION_NAMES[type]}
            </button>
          ))}
        </div>

        {playerFormation && (
          <div
            className="p-2 rounded text-xs"
            style={{
              backgroundColor: 'rgba(255,255,255,0.1)',
              color: COLORS.parchment,
              border: `1px solid ${COLORS.gold}`,
              fontFamily: '"Ma Shan Zheng", serif',
            }}
          >
            <div className="font-bold" style={{ color: COLORS.gold }}>
              {FORMATIONS[playerFormation].nameCN}
            </div>
            <div>{FORMATIONS[playerFormation].description}</div>
            <div className="mt-1">
              攻击加成: +{Math.round((FORMATIONS[playerFormation].attackBonus - 1) * 100)}%
              <br />
              防御加成: +{Math.round((FORMATIONS[playerFormation].defenseBonus - 1) * 100)}%
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-2">
          <button
            onClick={handleDownload}
            className="flex-1 px-3 py-2 rounded transition-all duration-100"
            style={{
              backgroundColor: COLORS.darkBrown,
              color: COLORS.parchment,
              border: `1px solid ${COLORS.gold}`,
              fontFamily: '"Ma Shan Zheng", serif',
              fontSize: '12px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = COLORS.gold;
              e.currentTarget.style.color = COLORS.darkBrown;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = COLORS.darkBrown;
              e.currentTarget.style.color = COLORS.parchment;
            }}
          >
            下载阵图
          </button>
          <button
            onClick={handleCopyLink}
            className="flex-1 px-3 py-2 rounded transition-all duration-100"
            style={{
              backgroundColor: COLORS.darkBrown,
              color: COLORS.parchment,
              border: `1px solid ${COLORS.gold}`,
              fontFamily: '"Ma Shan Zheng", serif',
              fontSize: '12px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = COLORS.gold;
              e.currentTarget.style.color = COLORS.darkBrown;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = COLORS.darkBrown;
              e.currentTarget.style.color = COLORS.parchment;
            }}
          >
            复制链接
          </button>
        </div>

        <button
          onClick={onReset}
          className="w-full px-4 py-2 rounded transition-all duration-100 mt-2"
          style={{
            backgroundColor: COLORS.darkBrown,
            color: COLORS.parchment,
            border: `1px solid ${COLORS.gold}`,
            fontFamily: '"Ma Shan Zheng", serif',
            fontSize: '14px',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = COLORS.gold;
            e.currentTarget.style.color = COLORS.darkBrown;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = COLORS.darkBrown;
            e.currentTarget.style.color = COLORS.parchment;
          }}
        >
          重置沙盘
        </button>

        <div className="mt-4">
          <h4
            className="font-bold mb-2"
            style={{
              fontFamily: '"Ma Shan Zheng", serif',
              color: COLORS.parchment,
              fontSize: '16px',
              borderBottom: `1px solid ${COLORS.gold}`,
              paddingBottom: '4px',
            }}
          >
            历史记录
          </h4>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {history.length === 0 ? (
              <div
                className="text-center py-4"
                style={{
                  color: 'rgba(245, 230, 200, 0.5)',
                  fontFamily: '"Ma Shan Zheng", serif',
                  fontSize: '12px',
                }}
              >
                暂无记录
              </div>
            ) : (
              history.map((item) => (
                <div
                  key={item.id}
                  onClick={() => onRestoreHistory(item.snapshot)}
                  className="p-2 rounded cursor-pointer transition-all duration-200 hover:scale-105"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    border: `1px solid ${COLORS.gold}`,
                    fontSize: '12px',
                  }}
                >
                  <div
                    style={{
                      color: COLORS.parchment,
                      fontFamily: '"Ma Shan Zheng", serif',
                    }}
                  >
                    {formatHistoryText(
                      item.playerFormation,
                      item.aiFormation,
                      item.result,
                      item.remaining
                    )}
                  </div>
                  <div
                    className="text-xs mt-1"
                    style={{ color: 'rgba(245, 230, 200, 0.6)' }}
                  >
                    {new Date(item.timestamp).toLocaleString('zh-CN')}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Panel;
