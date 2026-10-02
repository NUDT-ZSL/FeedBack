import React from 'react';
import { motion } from 'framer-motion';
import { Particle as ParticleType } from '../types';

interface ParticleProps {
  particle: ParticleType;
}

export const Particle: React.FC<ParticleProps> = ({ particle }) => {
  const opacity = particle.life / particle.maxLife;
  const scale = 0.5 + opacity * 0.5;

  if (particle.type === 'smoke' || particle.type === 'mist') {
    return (
      <motion.div
        className={`particle ${particle.type}`}
        style={{
          position: 'absolute',
          left: particle.position.x,
          top: particle.position.y,
          width: particle.size,
          height: particle.size,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${particle.color} 0%, transparent 70%)`,
          pointerEvents: 'none',
          zIndex: 30
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{
          scale: scale * 2,
          opacity: opacity * 0.7
        }}
        transition={{ duration: 0.3 }}
      />
    );
  }

  if (particle.type === 'dust') {
    return (
      <motion.div
        className={`particle ${particle.type}`}
        style={{
          position: 'absolute',
          left: particle.position.x,
          top: particle.position.y,
          width: particle.size,
          height: particle.size,
          background: particle.color,
          borderRadius: particle.size > 4 ? '2px' : '50%',
          pointerEvents: 'none',
          zIndex: 30,
          boxShadow: `0 0 ${particle.size}px ${particle.color}`
        }}
        animate={{
          opacity: opacity,
          scale: scale
        }}
        transition={{ duration: 0.1 }}
      />
    );
  }

  if (particle.type === 'spatter') {
    return (
      <motion.div
        className={`particle ${particle.type}`}
        style={{
          position: 'absolute',
          left: particle.position.x,
          top: particle.position.y,
          width: particle.size,
          height: particle.size,
          background: particle.color,
          borderRadius: '50% 20% 50% 20%',
          pointerEvents: 'none',
          zIndex: 30,
          boxShadow: `0 0 ${particle.size / 2}px ${particle.color}`
        }}
        animate={{
          opacity: opacity,
          rotate: particle.life * 10
        }}
        transition={{ duration: 0.1 }}
      />
    );
  }

  if (particle.type === 'oil') {
    return (
      <motion.div
        className={`particle ${particle.type}`}
        style={{
          position: 'absolute',
          left: particle.position.x,
          top: particle.position.y,
          width: particle.size * 1.5,
          height: particle.size,
          background: `radial-gradient(ellipse, ${particle.color} 0%, transparent 80%)`,
          borderRadius: '50%',
          pointerEvents: 'none',
          zIndex: 30
        }}
        animate={{
          opacity: opacity * 0.8,
          scaleX: scale * 1.5
        }}
        transition={{ duration: 0.15 }}
      />
    );
  }

  return (
    <motion.div
      className={`particle ${particle.type}`}
      style={{
        position: 'absolute',
        left: particle.position.x,
        top: particle.position.y,
        width: particle.size,
        height: particle.size,
        background: particle.color,
        borderRadius: '50%',
        pointerEvents: 'none',
        zIndex: 30
      }}
      animate={{ opacity }}
      transition={{ duration: 0.1 }}
    />
  );
};
