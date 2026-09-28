import React from 'react';
import { BoardState, CellState, RuneColor } from '../types';

interface GameBoardProps {
  board: BoardState;
  onCellClick: (row: number, col: number) => void;
  selectedColor: RuneColor;
}

const colorStyles: Record<RuneColor, React.CSSProperties> = {
  red: {
    background: 'radial-gradient(circle at 35% 35%, #ff6b6b, #c0392b)',
    boxShadow: '0 0 12px rgba(255, 107, 107, 0.6), inset 0 0 8px rgba(255,255,255,0.2)',
  },
  blue: {
    background: 'radial-gradient(circle at 35% 35%, #74b9ff, #2980b9)',
    boxShadow: '0 0 12px rgba(116, 185, 255, 0.6), inset 0 0 8px rgba(255,255,255,0.2)',
  },
  green: {
    background: 'radial-gradient(circle at 35% 35%, #55efc4, #27ae60)',
    boxShadow: '0 0 12px rgba(85, 239, 196, 0.6), inset 0 0 8px rgba(255,255,255,0.2)',
  },
};

const runeSymbols: Record<RuneColor, string> = {
  red: '🔥',
  blue: '⚡',
  green: '🌿',
};

const GameBoard: React.FC<GameBoardProps> = ({ board, onCellClick, selectedColor }) => {
  const rows = board.length;
  const cols = board[0]?.length || 0;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 56px)`,
        gridTemplateRows: `repeat(${rows}, 56px)`,
        gap: '4px',
        padding: '16px',
        background: 'rgba(45, 27, 78, 0.5)',
        borderRadius: '12px',
        border: '2px solid rgba(139, 92, 246, 0.3)',
      }}
    >
      {board.flatMap((row) =>
        row.map((cell) => (
          <div
            key={cell.id}
            onClick={() => onCellClick(cell.row, cell.col)}
            style={{
              width: 56,
              height: 56,
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '24px',
              transition: 'all 0.2s ease',
              ...(cell.color
                ? {
                    ...colorStyles[cell.color],
                    transform: cell.isSelected ? 'scale(1.15)' : cell.isEliminating ? 'scale(0.5)' : 'scale(1)',
                    opacity: cell.isEliminating ? 0.3 : 1,
                  }
                : {
                    background: 'rgba(30, 15, 60, 0.6)',
                    border: '1px dashed rgba(139, 92, 246, 0.2)',
                  }),
            }}
          >
            {cell.color ? runeSymbols[cell.color] : ''}
          </div>
        ))
      )}
    </div>
  );
};

export default GameBoard;
