import React from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import type { GuestReactionType } from '../utils/guestLogic';

interface PartMotion {
  head: { rotate: number[]; duration: number; repeat: number };
  cup: { y: number[]; duration: number };
  hand: { opacity: number[]; y: number[]; duration: number };
}

function reactionMotion(type: GuestReactionType, intensity: number): PartMotion {
  switch (type) {
    case 'cheer':
      return {
        head: { rotate: [0, -8, 8, 0], duration: 0.55, repeat: 1 },
        cup: { y: [0, -18 - 14 * intensity, -6, 0], duration: 0.6 },
        hand: { opacity: [0], y: [0], duration: 0.3 },
      };
    case 'shake':
      return {
        head: {
          rotate: [0, -16 * intensity, 14 * intensity, 0],
          duration: 0.5,
          repeat: 1,
        },
        cup: { y: [0], duration: 0.3 },
        hand: { opacity: [0], y: [0], duration: 0.3 },
      };
    case 'laugh':
      return {
        head: { rotate: [0, 10, 0], duration: 0.5, repeat: 1 },
        cup: { y: [0], duration: 0.3 },
        hand: { opacity: [0, 1, 1, 0], y: [0, -12, -10, 0], duration: 0.55 },
      };
    case 'watch':
      return {
        head: { rotate: [0, 9 * intensity, 0], duration: 0.6, repeat: 0 },
        cup: { y: [0, 3, 0], duration: 0.6 },
        hand: { opacity: [0], y: [0], duration: 0.3 },
      };
    case 'nervous':
      return {
        head: { rotate: [0, -4, 4, -4, 4, 0], duration: 0.45, repeat: 2 },
        cup: { y: [0, 2, 0], duration: 0.45 },
        hand: { opacity: [0], y: [0], duration: 0.3 },
      };
    default:
      return {
        head: { rotate: [0], duration: 0.25, repeat: 0 },
        cup: { y: [0], duration: 0.25 },
        hand: { opacity: [0], y: [0], duration: 0.25 },
      };
  }
}

const FAVORED_LABEL: Record<string, string> = {
  hit: '好投中',
  ear: '好卡耳',
};

const NPCGuests: React.FC = () => {
  const guests = useGameStore((state) => state.guests);
  const reactions = useGameStore((state) => state.guestReactions);

  return (
    <div className="npc-area">
      {guests.map((guest, index) => {
        const reaction = reactions[index] ?? { type: 'idle', intensity: 0 };
        const motionParts = reactionMotion(
          reaction.type,
          reaction.intensity
        );

        return (
          <div
            key={guest.id}
            className={`npc-guest react-${reaction.type}`}
            title={`席次 ${guest.seatIndex + 1} · ${FAVORED_LABEL[guest.favored]}`}
          >
            <motion.div
              className="npc-head"
              initial={{ x: '-50%', rotate: 0 }}
              animate={{
                x: '-50%',
                rotate: motionParts.head.rotate,
              }}
              transition={{
                duration: motionParts.head.duration,
                repeat: motionParts.head.repeat,
                ease: 'easeInOut',
              }}
            />
            <div className="npc-body" style={{ background: guest.color }} />
            <motion.div
              className="npc-cup"
              initial={{ x: '-50%', y: 0 }}
              animate={{ x: '-50%', y: motionParts.cup.y }}
              transition={{
                duration: motionParts.cup.duration,
                ease: 'easeOut',
              }}
            />
            <motion.div
              className="npc-hand npc-hand-left"
              animate={{ opacity: 0 }}
            />
            <motion.div
              className="npc-hand npc-hand-right"
              initial={{ x: 0, y: 0, opacity: 0 }}
              animate={{
                opacity: motionParts.hand.opacity,
                y: motionParts.hand.y,
              }}
              transition={{
                duration: motionParts.hand.duration,
                ease: 'easeInOut',
              }}
            />
            <div className={`npc-badge npc-badge-${guest.favored}`}>
              {guest.favored === 'hit' ? '中' : '耳'}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default NPCGuests;
