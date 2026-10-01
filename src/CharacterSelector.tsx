import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import type { Character } from './types';
import { RADICAL_GROUPS, getCharactersByRadical } from './data/characters';
import { playWoodClickSound } from './utils/audio';

interface CharacterSelectorProps {
  onCharacterSelect: (char: Character, e: React.MouseEvent | React.TouchEvent) => void;
  disabled?: boolean;
}

const CharacterSelector: React.FC<CharacterSelectorProps> = ({ onCharacterSelect, disabled }) => {
  const [activeRadical, setActiveRadical] = useState<string>(RADICAL_GROUPS[0].radical);
  const [draggingCharId, setDraggingCharId] = useState<string | null>(null);

  const characters = getCharactersByRadical(activeRadical);

  const handleDragStart = useCallback((char: Character, e: React.MouseEvent | React.TouchEvent) => {
    if (disabled) return;
    setDraggingCharId(char.id);
    playWoodClickSound();
    onCharacterSelect(char, e);
  }, [disabled, onCharacterSelect]);

  const handleDragEnd = useCallback(() => {
    setDraggingCharId(null);
  }, []);

  return (
    <div className="character-selector">
      <h3 className="selector-title">字架 - 按部首拣字</h3>
      
      <div className="radical-tabs">
        {RADICAL_GROUPS.map((group) => (
          <button
            key={group.radical}
            className={`radical-tab ${activeRadical === group.radical ? 'active' : ''}`}
            onClick={() => setActiveRadical(group.radical)}
            title={group.name}
            disabled={disabled}
          >
            {group.radical}
          </button>
        ))}
      </div>
      
      <div className="character-grid">
        {characters.map((char) => (
          <motion.div
            key={char.id}
            className={`character-tile ${draggingCharId === char.id ? 'dragging' : ''}`}
            drag
            dragMomentum={false}
            dragElastic={0}
            onDragStart={(e) => handleDragStart(char, e as unknown as React.MouseEvent)}
            onDragEnd={handleDragEnd}
            whileHover={{ scale: disabled ? 1 : 1.05 }}
            whileTap={{ scale: disabled ? 1 : 0.95 }}
            style={{ opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'grab' }}
            title={`${char.char} (${char.radicalName})`}
          >
            {char.char}
          </motion.div>
        ))}
      </div>
      
      <p className="hint-text">拖拽活字至右侧排版盘</p>
    </div>
  );
};

export default CharacterSelector;
