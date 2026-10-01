import React, { useState, useRef, useCallback } from 'react';
import { TimelineEvent, CATEGORY_COLORS, CATEGORY_LABELS } from './types';

interface EventCardProps {
  event: TimelineEvent;
  x: number;
  y: number;
  isBranch: boolean;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDragStart: (id: string, e: React.MouseEvent) => void;
}

const EventCard: React.FC<EventCardProps> = ({
  event,
  x,
  y,
  isBranch,
  isSelected,
  onSelect,
  onDragStart,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const nodeSize = isBranch ? 8 : 10;
  const color = CATEGORY_COLORS[event.category];

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(event.id);
      onDragStart(event.id, e);
    },
    [event.id, onSelect, onDragStart]
  );

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };

  return (
    <div
      className="event-node-wrapper"
      style={{ left: x, top: y }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div
        className={`event-node ${isSelected ? 'is-selected' : ''} ${event.isDeleting ? 'deleting' : ''}`}
        style={{
          width: nodeSize,
          height: nodeSize,
          background: color,
        }}
        onMouseDown={handleMouseDown}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(event.id);
        }}
      />

      <div
        className={`event-tooltip ${showTooltip ? 'visible' : ''}`}
        style={{
          left: 0,
          top: -nodeSize / 2 - 12,
        }}
      >
        <div className="tooltip-title">
          <span
            className="tooltip-category-tag"
            style={{ background: color }}
          />
          {event.title}
        </div>
        <div className="tooltip-date">
          {CATEGORY_LABELS[event.category]} · {formatDate(event.date)}
        </div>
        {event.description && (
          <div className="tooltip-description">{event.description}</div>
        )}
      </div>
    </div>
  );
};

export default React.memo(EventCard);
