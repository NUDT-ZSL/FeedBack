import React from 'react';
import { motion } from 'framer-motion';
import { Particle, Projectile } from '../game/types';
import { AMMO_CONFIGS } from '../game/constants';

interface ParticleSystemProps {
  particles: Particle[];
  projectiles: Projectile[];
}

export const ParticleSystem: React.FC<ParticleSystemProps> = ({ particles, projectiles }) => {
  const renderProjectile = (projectile: Projectile) => {
    const isFire = projectile.type === 'fire';

    return (
      <g key={projectile.id}>
        {isFire && (
          <>
            <motion.circle
              cx={projectile.x}
              cy={projectile.y}
              r="12"
              fill="#ff4500"
              opacity="0.4"
              animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0.6, 0.4] }}
              transition={{ duration: 0.2, repeat: Infinity }}
            />
            <motion.circle
              cx={projectile.x}
              cy={projectile.y}
              r="8"
              fill="#ff6a00"
              opacity="0.7"
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 0.15, repeat: Infinity }}
            />
          </>
        )}
        <circle
          cx={projectile.x}
          cy={projectile.y}
          r={isFire ? 6 : 8}
          fill={isFire ? '#ffcc00' : '#8a7a5a'}
          stroke={isFire ? '#ff4500' : '#5a4a3a'}
          strokeWidth="2"
        />
        {isFire && (
          <motion.circle
            cx={projectile.x - 3}
            cy={projectile.y - 3}
            r="2"
            fill="#fff"
            opacity="0.8"
            animate={{ opacity: [0.8, 0.3, 0.8] }}
            transition={{ duration: 0.1, repeat: Infinity }}
          />
        )}
      </g>
    );
  };

  const renderParticle = (particle: Particle) => {
    const opacity = particle.life / particle.maxLife;

    switch (particle.type) {
      case 'stone':
        return (
          <rect
            key={particle.id}
            x={particle.x - particle.size / 2}
            y={particle.y - particle.size / 2}
            width={particle.size}
            height={particle.size}
            fill={AMMO_CONFIGS.stone.particleColor}
            opacity={opacity}
            transform={`rotate(${particle.x * 0.5}, ${particle.x}, ${particle.y})`}
          />
        );
      case 'fire':
        return (
          <g key={particle.id}>
            <motion.circle
              cx={particle.x}
              cy={particle.y}
              r={particle.size}
              fill={AMMO_CONFIGS.fire.particleColor}
              opacity={opacity * 0.8}
              animate={{ scale: [1, 1.3, 1] }}
              transition={{ duration: 0.2, repeat: Infinity }}
            />
            <circle
              cx={particle.x}
              cy={particle.y}
              r={particle.size * 0.6}
              fill="#ffcc00"
              opacity={opacity}
            />
          </g>
        );
      case 'arrow':
        const angle = Math.atan2(particle.vy, particle.vx) * (180 / Math.PI);
        return (
          <g
            key={particle.id}
            transform={`translate(${particle.x}, ${particle.y}) rotate(${angle})`}
            opacity={opacity}
          >
            <line x1="-8" y1="0" x2="4" y2="0" stroke="#6a6a6a" strokeWidth="1.5" />
            <polygon points="4,0 -2,-3 -2,3" fill="#4a4a4a" />
            <line x1="-8" y1="0" x2="-10" y2="-2" stroke="#8a6a4a" strokeWidth="1" />
            <line x1="-8" y1="0" x2="-10" y2="2" stroke="#8a6a4a" strokeWidth="1" />
          </g>
        );
      default:
        return null;
    }
  };

  return (
    <g>
      {projectiles.map(renderProjectile)}
      {particles.map(renderParticle)}
    </g>
  );
};
