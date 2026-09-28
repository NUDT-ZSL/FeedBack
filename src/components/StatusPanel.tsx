import React from 'react';
import { PlayerState, LevelConfig, Skill, RuneColor } from '../types';

interface StatusPanelProps {
  player: PlayerState;
  level: LevelConfig | null;
  skills: Skill[];
  onSkillUse: (skillId: string) => void;
  onColorSelect: (color: RuneColor) => void;
  onRestart: () => void;
}

const StatusPanel: React.FC<StatusPanelProps> = ({
  player,
  level,
  skills,
  onSkillUse,
  onColorSelect,
  onRestart,
}) => {
  const colors: { value: RuneColor; label: string; bg: string }[] = [
    { value: 'red', label: '🔥 Red', bg: '#c0392b' },
    { value: 'blue', label: '⚡ Blue', bg: '#2980b9' },
    { value: 'green', label: '🌿 Green', bg: '#27ae60' },
  ];

  return (
    <div
      style={{
        width: 260,
        padding: 20,
        background: 'rgba(45, 27, 78, 0.6)',
        borderRadius: 12,
        border: '1px solid rgba(139, 92, 246, 0.3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <h2 style={{ textAlign: 'center', color: '#b794f6', marginBottom: 4 }}>
        Level {player.currentLevel}
      </h2>

      {level && (
        <div style={{ fontSize: 14, color: '#a0a0c0' }}>
          Target: {level.targetScore} pts
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Score</span>
          <span style={{ color: '#fbd38d', fontWeight: 'bold' }}>{player.score}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Mana</span>
          <span style={{ color: '#90cdf4', fontWeight: 'bold' }}>{player.mana}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Steps</span>
          <span style={{ color: '#fc8181', fontWeight: 'bold' }}>{player.stepsRemaining}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Runes</span>
          <span style={{ color: '#68d391', fontWeight: 'bold' }}>{player.totalRunesEliminated}</span>
        </div>
      </div>

      <div>
        <div style={{ marginBottom: 6, fontSize: 13, color: '#a0a0c0' }}>Place Rune Color:</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {colors.map((c) => (
            <button
              key={c.value}
              onClick={() => onColorSelect(c.value)}
              style={{
                flex: 1,
                padding: '6px 4px',
                background: player.selectedColor === c.value ? c.bg : 'rgba(30,15,60,0.8)',
                border: player.selectedColor === c.value ? '2px solid #fff' : '1px solid rgba(139,92,246,0.3)',
                borderRadius: 6,
                color: '#e0d0f0',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ marginBottom: 6, fontSize: 13, color: '#a0a0c0' }}>Skills</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {skills.map((skill) => (
            <button
              key={skill.id}
              onClick={() => onSkillUse(skill.id)}
              disabled={player.mana < skill.manaCost}
              style={{
                padding: '8px 10px',
                background: player.mana >= skill.manaCost ? 'rgba(139,92,246,0.3)' : 'rgba(30,15,60,0.5)',
                border: '1px solid rgba(139,92,246,0.4)',
                borderRadius: 6,
                color: player.mana >= skill.manaCost ? '#e0d0f0' : '#666',
                cursor: player.mana >= skill.manaCost ? 'pointer' : 'not-allowed',
                textAlign: 'left',
                fontSize: 12,
              }}
            >
              {skill.icon} {skill.name} ({skill.manaCost} mana)
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={onRestart}
        style={{
          padding: '10px',
          background: 'rgba(192, 57, 43, 0.4)',
          border: '1px solid rgba(192, 57, 43, 0.6)',
          borderRadius: 8,
          color: '#e0d0f0',
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        Restart Level
      </button>
    </div>
  );
};

export default StatusPanel;
