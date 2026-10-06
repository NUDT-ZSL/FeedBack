// 围观者组件（被 Stage 调用）
import { memo } from 'react';
import type { AudienceState } from '@/types';

interface AudienceProps {
  audience: AudienceState;
}

const TYPE_EMOJI: Record<string, string> = {
  scholar: '🧑‍🎓',
  merchant: '🧔',
  elder: '👴',
  child: '🧒',
};

const Audience = memo(function Audience({ audience }: AudienceProps) {
  // 情绪决定看客状态：≥60 喝彩，≤30 叹气
  const anim = audience.mood >= 60 ? 'anim-cheer' : audience.mood <= 30 ? 'anim-sigh' : '';
  return (
    <>
      {audience.members.map((m) => (
        <div
          key={m.id}
          className={`absolute z-10 select-none ${anim}`}
          style={{
            left: `${m.position.x}%`,
            top: `${m.position.y}%`,
            fontSize: m.type === 'child' ? '28px' : '36px',
            animationDelay: `${(m.position.x % 7) * 0.1}s`,
          }}
          title={m.type}
        >
          <span
            className="inline-block rounded-full px-1"
            style={{ backgroundColor: `${m.color}33`, border: `2px solid ${m.color}` }}
          >
            {TYPE_EMOJI[m.type] ?? '🧑'}
          </span>
        </div>
      ))}
    </>
  );
});

export default Audience;
