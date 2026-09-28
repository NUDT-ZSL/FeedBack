import React from 'react';
import { Idea, Tag, STATUS_LABELS, STATUS_COLORS } from '../utils/types';

interface IdeaCardProps {
  idea: Idea;
  tags: Tag[];
  onClick: (idea: Idea) => void;
  style?: React.CSSProperties;
}

const IdeaCard: React.FC<IdeaCardProps> = React.memo(({ idea, tags, onClick, style }) => {
  const summary = idea.description.length > 50 ? idea.description.slice(0, 50) + '…' : idea.description;

  const ideaTags = idea.tags
    .map((tid) => tags.find((t) => t.id === tid))
    .filter(Boolean) as Tag[];

  return (
    <div className="idea-card" onClick={() => onClick(idea)} style={style}>
      {idea.imageUrl && (
        <div className="idea-card-img">
          <img src={idea.imageUrl} alt={idea.title} loading="lazy" />
        </div>
      )}
      <div className="idea-card-body">
        <h3 className="idea-card-title">{idea.title}</h3>
        <p className="idea-card-summary">{summary}</p>
        <div className="idea-card-tags">
          {ideaTags.map((tag) => (
            <span key={tag.id} className="idea-tag-chip" style={{ backgroundColor: tag.color + '30', color: tag.color, borderColor: tag.color }}>
              {tag.name}
            </span>
          ))}
        </div>
        <div className="idea-card-footer">
          <div className="idea-card-stars">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className={i < idea.priority ? 'star filled' : 'star'}>
                ★
              </span>
            ))}
          </div>
          <span className="idea-status-pill" style={{ backgroundColor: STATUS_COLORS[idea.status] + '25', color: STATUS_COLORS[idea.status], borderColor: STATUS_COLORS[idea.status] }}>
            {STATUS_LABELS[idea.status]}
          </span>
        </div>
      </div>
    </div>
  );
});

IdeaCard.displayName = 'IdeaCard';
export default IdeaCard;
