import { memo, useState, useCallback } from 'react';
import type { Word } from '../types';
import { PART_OF_SPEECH_LABELS, PART_OF_SPEECH_COLORS } from '../types';
import { getUrgencyScore, getUrgencyColor } from '../data/words';

interface WordCardProps {
  word: Word;
  highlight: boolean;
  onUpdateMastery: (id: string, mastery: number) => void;
  onQuickReview: (word: Word) => void;
}

const Star = memo(function Star({
  filled,
  pulsing,
  onClick,
}: {
  filled: boolean;
  pulsing: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`word-card__star ${pulsing ? 'is-pulse' : ''}`}
      aria-label={filled ? '已标星' : '未标星'}
      style={{
        color: filled ? '#F5C400' : '#D8D8D8',
      }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l2.95 6.04 6.66.97-4.81 4.68 1.14 6.61L12 17.58l-5.94 2.72 1.14-6.61L2.39 9.01l6.66-.97L12 2z" />
      </svg>
    </button>
  );
});

function WordCardComponent({ word, highlight, onUpdateMastery, onQuickReview }: WordCardProps) {
  const [pulsingIndex, setPulsingIndex] = useState<number | null>(null);
  const urgency = getUrgencyScore(word);
  const urgencyColor = getUrgencyColor(urgency);

  const handleStarClick = useCallback(
    (idx: number) => {
      const target = idx + 1;
      setPulsingIndex(idx);
      onUpdateMastery(word.id, target);
      setTimeout(() => setPulsingIndex(null), 300);
    },
    [word.id, onUpdateMastery],
  );

  const posColor = PART_OF_SPEECH_COLORS[word.partOfSpeech];

  return (
    <div className={`word-card ${highlight ? 'is-highlight' : ''}`}>
      <div
        className="word-card__pos-tag"
        style={{
          backgroundColor: posColor,
        }}
        title={PART_OF_SPEECH_LABELS[word.partOfSpeech]}
      >
        {PART_OF_SPEECH_LABELS[word.partOfSpeech]}
      </div>

      <div className="word-card__content">
        <div className="word-card__english">{word.english}</div>
        <div className="word-card__chinese">{word.chinese}</div>
        <div className="word-card__urgency-row" title={`复习紧迫度 ${urgency}/100`}>
          <div className="word-card__urgency-bar">
            <div
              className="word-card__urgency-fill"
              style={{
                width: `${urgency}%`,
                background: `linear-gradient(90deg, ${urgencyColor}, ${urgencyColor})`,
              }}
            />
          </div>
          <span className="word-card__urgency-label" style={{ color: urgencyColor }}>
            {urgency}
          </span>
        </div>
      </div>

      <div className="word-card__actions">
        <div className="word-card__stars">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              filled={i < word.mastery}
              pulsing={pulsingIndex === i}
              onClick={() => handleStarClick(i)}
            />
          ))}
        </div>
        <button
          type="button"
          className="word-card__quick-btn"
          onClick={() => onQuickReview(word)}
          title="快速复习此单词"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span>复习</span>
        </button>
      </div>
    </div>
  );
}

export const WordCard = memo(WordCardComponent);
