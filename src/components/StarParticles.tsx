import React, { useMemo } from 'react';

const StarParticles: React.FC = () => {
  const particles = useMemo(() => {
    const p = [];
    for (let i = 0; i < 100; i++) {
      p.push({
        left: Math.random() * 100,
        top: Math.random() * 100,
        delay: Math.random() * 3,
        size: 1 + Math.random() * 2,
      });
    }
    return p;
  }, []);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      pointerEvents: 'none',
      zIndex: 1,
    }}>
      {particles.map((p, i) => (
        <div
          key={i}
          className="star-particle"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            animationDelay: `${p.delay}s`,
            width: `${p.size}px`,
            height: `${p.size}px`,
          }}
        />
      ))}
    </div>
  );
};

export default StarParticles;
