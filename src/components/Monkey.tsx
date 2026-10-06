// 猴子角色组件（被 Stage 调用）
import { memo } from 'react';
import type { MonkeyState } from '@/types';

interface MonkeyProps {
  monkey: MonkeyState;
}

function animationClass(monkey: MonkeyState): string {
  if (monkey.isStunned) return 'anim-stun';
  switch (monkey.currentAction?.id) {
    case 'climb': return 'anim-climb';
    case 'somersault': return 'anim-flip';
    case 'handstand': return 'anim-handstand';
    case 'triple-flip': return 'anim-triple';
    case 'rest': return 'anim-rest';
    default: return '';
  }
}

const Monkey = memo(function Monkey({ monkey }: MonkeyProps) {
  const cls = animationClass(monkey);
  return (
    <div
      className="absolute z-20 select-none"
      style={{ left: '50%', top: '62%' }}
      aria-label="猴子"
    >
      <div className={`relative text-5xl ${cls}`} style={{ transformOrigin: '50% 100%' }}>
        🐒
        {monkey.isStunned && (
          <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-xl">💫</span>
        )}
      </div>
    </div>
  );
});

export default Monkey;
