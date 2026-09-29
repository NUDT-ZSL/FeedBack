import React, { useEffect, useRef } from 'react';

interface HealthGaugeProps {
  score: number;
}

const HealthGauge: React.FC<HealthGaugeProps> = ({ score }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const needleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height;
    const radius = Math.min(width, height * 2) - 20;

    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#FF4444');
    gradient.addColorStop(0.5, '#FF9800');
    gradient.addColorStop(1, '#4CAF50');

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, Math.PI, 0, false);
    ctx.lineWidth = 24;
    ctx.strokeStyle = '#E0E0E0';
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.beginPath();
    const startAngle = Math.PI;
    const endAngle = Math.PI + (score / 100) * Math.PI;
    ctx.arc(centerX, centerY, radius, startAngle, endAngle, false);
    ctx.lineWidth = 24;
    ctx.strokeStyle = gradient;
    ctx.lineCap = 'round';
    ctx.stroke();

    for (let i = 0; i <= 10; i++) {
      const angle = Math.PI + (i / 10) * Math.PI;
      const tickX1 = centerX + (radius - 35) * Math.cos(angle);
      const tickY1 = centerY + (radius - 35) * Math.sin(angle);
      const tickX2 = centerX + (radius - 28) * Math.cos(angle);
      const tickY2 = centerY + (radius - 28) * Math.sin(angle);

      ctx.beginPath();
      ctx.moveTo(tickX1, tickY1);
      ctx.lineTo(tickX2, tickY2);
      ctx.lineWidth = i % 5 === 0 ? 2 : 1;
      ctx.strokeStyle = '#999';
      ctx.stroke();
    }
  }, [score]);

  useEffect(() => {
    const needle = needleRef.current;
    if (!needle) return;

    const angle = -90 + (score / 100) * 180;
    needle.style.setProperty('--needle-angle', `${angle}deg`);
  }, [score]);

  return (
    <div style={{
      position: 'relative',
      width: '300px',
      height: '170px',
      margin: '0 auto',
    }}>
      <canvas
        ref={canvasRef}
        width={300}
        height={170}
        style={{ display: 'block' }}
      />
      <div
        ref={needleRef}
        style={{
          position: 'absolute',
          bottom: '0',
          left: '50%',
          width: '4px',
          height: '120px',
          background: 'linear-gradient(to top, #333 0%, #666 50%, #333 100%)',
          borderRadius: '2px',
          transformOrigin: 'bottom center',
          transform: `rotate(${-90 + (score / 100) * 180}deg) translateX(-50%)`,
          transition: 'transform 0.5s ease-out',
          animation: 'needle-swing 0.5s ease-in-out infinite',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '-5px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          background: '#333',
          border: '3px solid #fff',
          boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          textAlign: 'center',
        }}
      >
        <div style={{
          fontSize: '36px',
          fontWeight: 'bold',
          color: score < 30 ? '#FF4444' : score < 60 ? '#FF9800' : '#4CAF50',
        }}>
          {Math.round(score)}
        </div>
        <div style={{
          fontSize: '12px',
          color: 'var(--color-text-light)',
        }}>
          健康指数
        </div>
      </div>
    </div>
  );
};

export default HealthGauge;
