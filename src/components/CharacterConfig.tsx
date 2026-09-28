import React, { useState, useEffect } from 'react';
import { CharacterConfig, SkillConfig } from '../types';
import { PRESET_SKILLS } from '../data/skills';

interface CharacterConfigProps {
  character: CharacterConfig;
  onChange: (char: CharacterConfig) => void;
  label: string;
  side: 'left' | 'right';
}

const StatSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step = 1, onChange }) => {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDisplayValue(value), 150);
    return () => clearTimeout(timer);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = Number(e.target.value);
    onChange(newValue);
  };

  return (
    <div className="stat-row">
      <div className="stat-label">
        <span>{label}</span>
        <span className="stat-value">{displayValue}</span>
      </div>
      <input
        type="range"
        className="stat-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
      />
    </div>
  );
};

const SkillIcon: React.FC<{
  skill: SkillConfig;
  selected: boolean;
  onClick: () => void;
}> = ({ skill, selected, onClick }) => {
  const emojiMap: Record<string, string> = {
    fire: '🔥',
    ice: '❄️',
    heal: '💚',
    lightning: '⚡',
    shield: '🛡️',
  };

  return (
    <div
      className={`skill-icon ${skill.type} ${selected ? 'selected' : ''}`}
      onClick={onClick}
      title={skill.name}
    >
      <span className="skill-emoji">{emojiMap[skill.type]}</span>
      <div className="skill-tooltip">
        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{skill.name}</div>
        <div>伤害: {skill.damage}</div>
        <div>冷却: {skill.cooldown}回合</div>
        <div>消耗: {skill.cost}</div>
      </div>
    </div>
  );
};

const CharacterConfigComponent: React.FC<CharacterConfigProps> = ({
  character,
  onChange,
  label,
  side,
}) => {
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...character, name: e.target.value });
  };

  const handleStatChange = (stat: keyof CharacterConfig, value: number) => {
    onChange({ ...character, [stat]: value });
  };

  const toggleSkill = (skill: SkillConfig) => {
    const isSelected = character.skills.some((s) => s.id === skill.id);
    if (isSelected) {
      onChange({
        ...character,
        skills: character.skills.filter((s) => s.id !== skill.id),
      });
    } else if (character.skills.length < 4) {
      onChange({
        ...character,
        skills: [...character.skills, skill],
      });
    }
  };

  return (
    <div className="panel">
      <h2>{label}</h2>
      <div className="character-config">
        <input
          type="text"
          className="character-name-input"
          value={character.name}
          onChange={handleNameChange}
          placeholder="角色名称"
        />

        <div className="stats-grid">
          <StatSlider
            label="生命值"
            value={character.hp}
            min={50}
            max={500}
            step={10}
            onChange={(v) => handleStatChange('hp', v)}
          />
          <StatSlider
            label="攻击力"
            value={character.attack}
            min={5}
            max={80}
            step={1}
            onChange={(v) => handleStatChange('attack', v)}
          />
          <StatSlider
            label="防御力"
            value={character.defense}
            min={0}
            max={50}
            step={1}
            onChange={(v) => handleStatChange('defense', v)}
          />
          <StatSlider
            label="速度"
            value={character.speed}
            min={5}
            max={40}
            step={1}
            onChange={(v) => handleStatChange('speed', v)}
          />
        </div>

        <div className="skills-section">
          <h3>技能库（最多选择4个）</h3>
          <div className="skills-grid">
            {PRESET_SKILLS.map((skill) => (
              <SkillIcon
                key={skill.id}
                skill={skill}
                selected={character.skills.some((s) => s.id === skill.id)}
                onClick={() => toggleSkill(skill)}
              />
            ))}
          </div>

          <div className="selected-skills">
            {character.skills.length === 0 ? (
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
                未选择技能
              </span>
            ) : (
              character.skills.map((skill) => (
                <span
                  key={skill.id}
                  className="selected-skill-tag"
                  style={{ borderLeft: `3px solid ${skill.color}` }}
                >
                  {skill.name}
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CharacterConfigComponent;
