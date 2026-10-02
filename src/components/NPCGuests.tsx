import React, { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';

interface Guest {
  id: number;
  color: string;
  reaction: 'idle' | 'cheer' | 'shake' | 'laugh';
}

const GUEST_COLORS = [
  '#c0392b',
  '#3a6b8d',
  '#ffd700',
  '#8e44ad',
  '#d4938b',
  '#27ae60',
];

const NPCGuests: React.FC = () => {
  const npcReaction = useGameStore((state) => state.npcReaction);
  const [guests, setGuests] = useState<Guest[]>(
    GUEST_COLORS.map((color, index) => ({
      id: index,
      color,
      reaction: 'idle',
    }))
  );

  useEffect(() => {
    if (npcReaction === 'cheer') {
      setGuests((prev) =>
        prev.map((guest) => ({ ...guest, reaction: 'cheer' }))
      );
      const timer = setTimeout(() => {
        setGuests((prev) =>
          prev.map((guest) => ({ ...guest, reaction: 'idle' }))
        );
      }, 800);
      return () => clearTimeout(timer);
    } else if (npcReaction === 'disappoint') {
      setGuests((prev) =>
        prev.map((guest, index) => ({
          ...guest,
          reaction: index % 2 === 0 ? 'shake' : 'laugh',
        }))
      );
      const timer = setTimeout(() => {
        setGuests((prev) =>
          prev.map((guest) => ({ ...guest, reaction: 'idle' }))
        );
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [npcReaction]);

  const getGuestClass = (reaction: Guest['reaction']) => {
    switch (reaction) {
      case 'cheer':
        return 'npc-guest npc-cheer';
      case 'shake':
        return 'npc-guest npc-shake-head';
      case 'laugh':
        return 'npc-guest npc-laugh';
      default:
        return 'npc-guest';
    }
  };

  return (
    <div className="npc-area">
      {guests.map((guest) => (
        <div key={guest.id} className={getGuestClass(guest.reaction)}>
          <div className="npc-head" />
          <div className="npc-body" style={{ background: guest.color }} />
          <div className="npc-cup" />
          <div className="npc-hand npc-hand-left" />
          <div className="npc-hand npc-hand-right" />
        </div>
      ))}
    </div>
  );
};

export default NPCGuests;
