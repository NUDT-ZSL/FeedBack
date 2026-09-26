import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/useGameStore';
import type { StarParticle } from '../types/game';

const STAR_COUNT = 50;

function StartScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<StarParticle[]>([]);
  const animationRef = useRef<number>(0);
  const startGame = useGameStore((state) => state.startGame);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const initStars = () => {
      const stars: StarParticle[] = [];
      for (let i = 0; i < STAR_COUNT; i++) {
        stars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 10,
          vy: (Math.random() - 0.5) * 10,
          size: 2,
          opacity: 0.3 + Math.random() * 0.4,
        });
      }
      starsRef.current = stars;
    };

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initStars();
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    let lastTime = 0;
    const animate = (timestamp: number) => {
      const deltaTime = Math.min((timestamp - lastTime) / 1000, 0.05);
      lastTime = timestamp;

      const width = window.innerWidth;
      const height = window.innerHeight;

      ctx.fillStyle = '#0D0D0D';
      ctx.fillRect(0, 0, width, height);

      for (const star of starsRef.current) {
        star.x += star.vx * deltaTime;
        star.y += star.vy * deltaTime;

        if (star.x < 0) star.x = width;
        if (star.x > width) star.x = 0;
        if (star.y < 0) star.y = height;
        if (star.y > height) star.y = 0;

        ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
        }}
      />
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '48px',
        }}
      >
        <h1
          style={{
            fontSize: '48px',
            fontWeight: 700,
            color: '#00FFFF',
            textShadow: '0 0 20px #00FFFF, 0 0 40px #0080FF, 0 0 60px #0080FF',
            margin: 0,
            letterSpacing: '8px',
          }}
        >
          时空裂隙
        </h1>
        <p
          style={{
            fontSize: '18px',
            color: '#9B59B6',
            textShadow: '0 0 10px #6A0DAD',
            margin: 0,
          }}
        >
          穿梭于扭曲时空的迷宫冒险
        </p>
        <button
          onClick={startGame}
          style={{
            width: '180px',
            height: '50px',
            background: 'linear-gradient(135deg, #6A0DAD 0%, #9B59B6 100%)',
            border: 'none',
            borderRadius: '12px',
            color: 'white',
            fontSize: '24px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 0 20px rgba(106, 13, 173, 0.5)',
            transition: 'all 200ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.05)';
            e.currentTarget.style.background =
              'linear-gradient(135deg, #9B59B6 0%, #6A0DAD 100%)';
            e.currentTarget.style.boxShadow =
              '0 0 30px rgba(155, 89, 182, 0.7)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.background =
              'linear-gradient(135deg, #6A0DAD 0%, #9B59B6 100%)';
            e.currentTarget.style.boxShadow =
              '0 0 20px rgba(106, 13, 173, 0.5)';
          }}
        >
          开始游戏
        </button>
        <div
          style={{
            marginTop: '32px',
            fontSize: '14px',
            color: '#666',
            textAlign: 'center',
            lineHeight: 1.8,
          }}
        >
          <p style={{ margin: '4px 0' }}>
            <span style={{ color: '#00FFFF' }}>WASD</span> 控制飞船移动
          </p>
          <p style={{ margin: '4px 0' }}>
            收集 <span style={{ color: '#FFD700' }}>时空碎片</span> 补充能量
          </p>
          <p style={{ margin: '4px 0' }}>
            躲避 <span style={{ color: '#FF00FF' }}>时空风暴</span> 减少消耗
          </p>
          <p style={{ margin: '4px 0' }}>
            到达 <span style={{ color: '#00FF00' }}>出口</span> 逃离迷宫
          </p>
        </div>
      </div>
    </div>
  );
}

export default StartScreen;
