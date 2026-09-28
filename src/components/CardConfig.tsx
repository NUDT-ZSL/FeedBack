import React, { useState } from 'react';
import { Card, CARD_LIBRARY } from './BattleEngine';

interface CardConfigProps {
  deckA: Card[];
  deckB: Card[];
  onDeckAChange: (deck: Card[]) => void;
  onDeckBChange: (deck: Card[]) => void;
}

const MAX_DECK_SIZE = 8;

const rarityIcons: Record<string, string> = {
  common: '◇',
  rare: '◆',
  epic: '✦',
};

const abilityNames: Record<string, string> = {
  charge: '冲锋',
  taunt: '嘲讽',
  divineShield: '圣盾',
};

const cardEmojis: Record<string, string> = {
  c1: '🛡️',
  c2: '🗡️',
  c3: '🏹',
  c4: '⚔️',
  c5: '✨',
  c6: '🪓',
  c7: '🛡️',
  c8: '🗡️',
  c9: '⚜️',
  c10: '👑',
  c11: '🏰',
  c12: '⚡',
};

const getRarityLabel = (rarity: string): string => {
  switch (rarity) {
    case 'common': return '普通';
    case 'rare': return '稀有';
    case 'epic': return '史诗';
    default: return '';
  }
};

const CardComponent: React.FC<{
  card: Card;
  inDeck?: boolean;
  onRemove?: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDoubleClick?: () => void;
  draggable?: boolean;
}> = ({ card, inDeck = false, onRemove, onDragStart, onDoubleClick, draggable = true }) => {
  return (
    <div
      className={`card rarity-${card.rarity}${inDeck ? ' card-in-deck' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDoubleClick={onDoubleClick}
      title={`${card.name} - ${getRarityLabel(card.rarity)}\n${card.abilityDesc}`}
    >
      {onRemove && (
        <button className="card-remove-btn" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          ×
        </button>
      )}
      <div className="card-cost">{card.cost}</div>
      {card.ability && (
        <div className="card-ability-tag">{abilityNames[card.ability]}</div>
      )}
      <div className="card-name">{card.name}</div>
      <div className="card-art">
        {cardEmojis[card.id] || rarityIcons[card.rarity]}
      </div>
      <div className="card-desc">{card.abilityDesc}</div>
      <div className="card-stats">
        <div className="card-attack">{card.attack}</div>
        <div className="card-health">{card.health}</div>
      </div>
    </div>
  );
};

export const CardConfig: React.FC<CardConfigProps> = ({
  deckA,
  deckB,
  onDeckAChange,
  onDeckBChange,
}) => {
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [deckACollapsed, setDeckACollapsed] = useState(false);
  const [deckBCollapsed, setDeckBCollapsed] = useState(false);
  const [dragOverDeck, setDragOverDeck] = useState<'A' | 'B' | null>(null);
  const [draggedCard, setDraggedCard] = useState<Card | null>(null);
  const [dragSource, setDragSource] = useState<'library' | 'deckA' | 'deckB'>('library');
  const [dragIndex, setDragIndex] = useState<number>(-1);

  const handleDragStart = (
    e: React.DragEvent,
    card: Card,
    source: 'library' | 'deckA' | 'deckB',
    index: number = -1,
  ) => {
    setDraggedCard(card);
    setDragSource(source);
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.id);
  };

  const handleDragOver = (e: React.DragEvent, deck: 'A' | 'B') => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDeck(deck);
  };

  const handleDragLeave = () => {
    setDragOverDeck(null);
  };

  const handleDrop = (e: React.DragEvent, deck: 'A' | 'B') => {
    e.preventDefault();
    setDragOverDeck(null);

    if (!draggedCard) return;

    if (deck === 'A') {
      if (dragSource === 'deckA') {
        return;
      }
      if (deckA.length >= MAX_DECK_SIZE) return;
      const newDeck = [...deckA, draggedCard];
      onDeckAChange(newDeck);
      if (dragSource === 'deckB') {
        const newDeckB = deckB.filter((_, i) => i !== dragIndex);
        onDeckBChange(newDeckB);
      }
    } else {
      if (dragSource === 'deckB') {
        return;
      }
      if (deckB.length >= MAX_DECK_SIZE) return;
      const newDeck = [...deckB, draggedCard];
      onDeckBChange(newDeck);
      if (dragSource === 'deckA') {
        const newDeckA = deckA.filter((_, i) => i !== dragIndex);
        onDeckAChange(newDeckA);
      }
    }

    setDraggedCard(null);
    setDragSource('library');
    setDragIndex(-1);
  };

  const handleRemoveFromDeck = (deck: 'A' | 'B', index: number) => {
    if (deck === 'A') {
      const newDeck = deckA.filter((_, i) => i !== index);
      onDeckAChange(newDeck);
    } else {
      const newDeck = deckB.filter((_, i) => i !== index);
      onDeckBChange(newDeck);
    }
  };

  const handleLibraryCardDoubleClick = (card: Card) => {
    if (deckA.length < MAX_DECK_SIZE) {
      onDeckAChange([...deckA, card]);
    }
  };

  return (
    <>
      <div className="collapsible-panel">
        <div
          className={`panel-header${libraryCollapsed ? ' collapsed' : ''}`}
          onClick={() => setLibraryCollapsed(!libraryCollapsed)}
        >
          <h2>
            <span className="faction-dot-a" style={{ background: '#9C27B0', boxShadow: '0 0 8px #9C27B0' }}></span>
            卡牌库
            <span className="deck-count">({CARD_LIBRARY.length}张)</span>
          </h2>
          <span className="toggle-icon">▼</span>
        </div>
        <div className={`panel-content${libraryCollapsed ? ' collapsed' : ''}`}>
          <div className="card-library">
            {CARD_LIBRARY.map((card) => (
              <CardComponent
                key={card.id}
                card={card}
                onDragStart={(e) => handleDragStart(e, card, 'library')}
                onDoubleClick={() => handleLibraryCardDoubleClick(card)}
              />
            ))}
          </div>
          <p style={{ padding: '0 16px 16px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>
            双击卡牌快速加入卡组A · 拖拽卡牌到卡组区域
          </p>
        </div>
      </div>

      <div className="collapsible-panel">
        <div
          className={`panel-header${deckACollapsed ? ' collapsed' : ''}`}
          onClick={() => setDeckACollapsed(!deckACollapsed)}
        >
          <h2>
            <span className="faction-dot-a"></span>
            卡组 A
            <span className="deck-count">({deckA.length}/{MAX_DECK_SIZE})</span>
          </h2>
          <span className="toggle-icon">▼</span>
        </div>
        <div className={`panel-content${deckACollapsed ? ' collapsed' : ''}`}>
          <div
            className={`deck-slots${dragOverDeck === 'A' ? ' drag-over' : ''}`}
            onDragOver={(e) => handleDragOver(e, 'A')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, 'A')}
          >
            {deckA.length === 0 ? (
              <div className="empty-state" style={{ width: '100%' }}>
                拖拽卡牌到此处组建卡组A
              </div>
            ) : (
              deckA.map((card, index) => (
                <CardComponent
                  key={`a-${index}-${card.id}`}
                  card={card}
                  inDeck
                  onRemove={() => handleRemoveFromDeck('A', index)}
                  onDragStart={(e) => handleDragStart(e, card, 'deckA', index)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <div className="collapsible-panel">
        <div
          className={`panel-header${deckBCollapsed ? ' collapsed' : ''}`}
          onClick={() => setDeckBCollapsed(!deckBCollapsed)}
        >
          <h2>
            <span className="faction-dot-b"></span>
            卡组 B
            <span className="deck-count">({deckB.length}/{MAX_DECK_SIZE})</span>
          </h2>
          <span className="toggle-icon">▼</span>
        </div>
        <div className={`panel-content${deckBCollapsed ? ' collapsed' : ''}`}>
          <div
            className={`deck-slots${dragOverDeck === 'B' ? ' drag-over' : ''}`}
            onDragOver={(e) => handleDragOver(e, 'B')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, 'B')}
          >
            {deckB.length === 0 ? (
              <div className="empty-state" style={{ width: '100%' }}>
                拖拽卡牌到此处组建卡组B
              </div>
            ) : (
              deckB.map((card, index) => (
                <CardComponent
                  key={`b-${index}-${card.id}`}
                  card={card}
                  inDeck
                  onRemove={() => handleRemoveFromDeck('B', index)}
                  onDragStart={(e) => handleDragStart(e, card, 'deckB', index)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
};
