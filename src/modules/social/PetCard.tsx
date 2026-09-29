import React, { useState } from 'react';
import { useSocial } from './SocialProvider';
import { PetCardData } from './types';
import { PET_EMOJI } from '../../mockService';

function StarRating({ score }: { score: number }) {
  return (
    <span style={{ fontSize: 14 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{ opacity: i < score ? 1 : 0.2 }}>
          ⭐
        </span>
      ))}
    </span>
  );
}

function LikeButton({ likes, onLike }: { likes: number; onLike: () => void }) {
  const [animating, setAnimating] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setAnimating(true);
    onLike();
    setTimeout(() => setAnimating(false), 200);
  };

  return (
    <button
      onClick={handleClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        padding: '4px 8px',
        borderRadius: 8,
        fontSize: 14,
        fontFamily: "'Nunito', sans-serif",
        fontWeight: 700,
        color: '#E53935',
        transition: 'background 0.2s ease-out',
        transform: animating ? 'scale(1.3)' : 'scale(1)',
        transitionProperty: 'transform, background',
        transitionDuration: '0.2s',
        transitionTimingFunction: 'ease-out',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.background = '#FFEBEE';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = 'none';
      }}
    >
      <span
        style={{
          fontSize: 18,
          display: 'inline-block',
          transform: animating ? 'scale(1.4)' : 'scale(1)',
          transition: 'transform 0.2s ease-out',
        }}
      >
        ❤️
      </span>
      <span>{likes}</span>
    </button>
  );
}

function PetCardItem({
  card,
  onClick,
}: {
  card: PetCardData;
  onClick: () => void;
}) {
  const { likePet } = useSocial();

  return (
    <div
      onClick={onClick}
      style={{
        background: '#FFFFFF',
        borderRadius: 12,
        padding: 20,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        cursor: 'pointer',
        transition: 'transform 0.3s ease-out, box-shadow 0.3s ease-out',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        border: '1px solid #FFF3E0',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1.1)';
        (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(255,140,66,0.2)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
        (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
      }}
    >
      <div style={{ fontSize: 40, lineHeight: 1 }}>{PET_EMOJI[card.type]}</div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 800,
          fontFamily: "'Nunito', sans-serif",
          color: '#5D4037',
        }}
      >
        {card.name}
      </div>
      <div
        style={{
          fontSize: 12,
          color: '#9E9E9E',
          fontFamily: "'Nunito', sans-serif",
          fontWeight: 600,
        }}
      >
        🧑 {card.ownerName}
      </div>
      <StarRating score={card.healthScore} />
      <LikeButton likes={card.likes} onLike={() => likePet(card.id)} />
    </div>
  );
}

function PetDetailModal({ card, onClose }: { card: PetCardData; onClose: () => void }) {
  const { likePet } = useSocial();
  const [animating, setAnimating] = useState(false);

  const handleLike = () => {
    setAnimating(true);
    likePet(card.id);
    setTimeout(() => setAnimating(false), 200);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#FFFFFF',
          borderRadius: 16,
          padding: 32,
          width: '90%',
          maxWidth: 420,
          boxShadow: '0 16px 48px rgba(0,0,0,0.15)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          animation: 'modalIn 0.3s ease-out',
        }}
      >
        <div style={{ fontSize: 72, lineHeight: 1 }}>{PET_EMOJI[card.type]}</div>
        <div
          style={{
            fontSize: 24,
            fontWeight: 800,
            fontFamily: "'Press Start 2P', cursive",
            color: '#FF8C42',
          }}
        >
          {card.name}
        </div>
        <div
          style={{
            fontSize: 14,
            color: '#9E9E9E',
            fontFamily: "'Nunito', sans-serif",
            fontWeight: 600,
          }}
        >
          主人: {card.ownerName}
        </div>
        <StarRating score={card.healthScore} />
        <div
          style={{
            fontSize: 13,
            color: '#795548',
            fontFamily: "'Nunito', sans-serif",
            textAlign: 'center',
            lineHeight: 1.6,
          }}
        >
          这是一只可爱的{card.type === 'cat' ? '小猫' : card.type === 'dog' ? '小狗' : '小龙'}，
          正在等待你的关注和点赞！
        </div>
        <button
          onClick={handleLike}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            border: 'none',
            borderRadius: 12,
            padding: '12px 28px',
            backgroundColor: '#FF8C42',
            color: '#FFF',
            fontSize: 16,
            fontWeight: 800,
            fontFamily: "'Nunito', sans-serif",
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(255,140,66,0.3)',
            transform: animating ? 'scale(1.2)' : 'scale(1)',
            transition: 'transform 0.2s ease-out',
          }}
        >
          <span style={{ fontSize: 20 }}>❤️</span>
          点赞 ({card.likes})
        </button>
        <button
          onClick={onClose}
          style={{
            border: 'none',
            background: 'none',
            color: '#9E9E9E',
            fontSize: 13,
            cursor: 'pointer',
            fontFamily: "'Nunito', sans-serif",
            fontWeight: 600,
            marginTop: 4,
          }}
        >
          关闭
        </button>
      </div>
      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.9) translateY(20px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}

export default function PetCardList() {
  const { state, getCurrentPageCards, dispatch } = useSocial();
  const [selectedCard, setSelectedCard] = useState<PetCardData | null>(null);
  const cards = getCurrentPageCards();

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 20,
        }}
      >
        {cards.map(card => (
          <PetCardItem
            key={card.id}
            card={card}
            onClick={() => setSelectedCard(card)}
          />
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 16,
          marginTop: 32,
        }}
      >
        <button
          onClick={() => dispatch({ type: 'SET_PAGE', page: state.currentPage - 1 })}
          disabled={state.currentPage <= 1}
          style={{
            padding: '8px 20px',
            border: 'none',
            borderRadius: 10,
            backgroundColor: state.currentPage <= 1 ? '#EFEBE9' : '#FF8C42',
            color: state.currentPage <= 1 ? '#BCAAA4' : '#FFF',
            fontWeight: 700,
            fontFamily: "'Nunito', sans-serif",
            cursor: state.currentPage <= 1 ? 'not-allowed' : 'pointer',
            fontSize: 14,
            transition: 'all 0.3s ease-out',
          }}
        >
          ← 上一页
        </button>
        <span
          style={{
            fontFamily: "'Nunito', sans-serif",
            fontWeight: 700,
            color: '#795548',
            fontSize: 14,
          }}
        >
          {state.currentPage} / {state.totalPages}
        </span>
        <button
          onClick={() => dispatch({ type: 'SET_PAGE', page: state.currentPage + 1 })}
          disabled={state.currentPage >= state.totalPages}
          style={{
            padding: '8px 20px',
            border: 'none',
            borderRadius: 10,
            backgroundColor: state.currentPage >= state.totalPages ? '#EFEBE9' : '#FF8C42',
            color: state.currentPage >= state.totalPages ? '#BCAAA4' : '#FFF',
            fontWeight: 700,
            fontFamily: "'Nunito', sans-serif",
            cursor: state.currentPage >= state.totalPages ? 'not-allowed' : 'pointer',
            fontSize: 14,
            transition: 'all 0.3s ease-out',
          }}
        >
          下一页 →
        </button>
      </div>

      {selectedCard && (
        <PetDetailModal
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
        />
      )}
    </div>
  );
}
