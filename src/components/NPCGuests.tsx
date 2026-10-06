import React from 'react';
import { useGameStore } from '../store/gameStore';
import type { GuestReaction } from '../utils/guestReactions';

const REACTION_CLASS: Record<GuestReaction['category'], string> = {
  idle: '',
  cheer: 'npc-cheer',
  shake: 'npc-shake-head',
  laugh: 'npc-laugh',
  watch: 'npc-watch',
  tense: 'npc-tense',
};

const NPCGuests: React.FC = () => {
  const guests = useGameStore((state) => state.guests);
  const guestReactions = useGameStore((state) => state.guestReactions);

  return (
    <div className="npc-area">
      {guests.map((guest) => {
        const reaction = guestReactions[guest.id] ?? { category: 'idle', intensity: 0 };
        const reactionClass = REACTION_CLASS[reaction.category];
        const className = reactionClass
          ? `npc-guest ${reactionClass}`
          : 'npc-guest';
        return (
          <div
            key={guest.id}
            className={className}
            style={
              {
                '--reaction-intensity': reaction.intensity,
              } as React.CSSProperties
            }
          >
            <div className="npc-head" />
            <div className="npc-body" style={{ background: guest.color }} />
            <div className="npc-cup" />
            <div className="npc-hand npc-hand-left" />
            <div className="npc-hand npc-hand-right" />
          </div>
        );
      })}
    </div>
  );
};

export default NPCGuests;
