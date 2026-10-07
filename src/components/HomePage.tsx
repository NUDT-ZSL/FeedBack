import React, { useEffect, useRef, useCallback } from 'react';

interface HomePageProps {
  onEnter: () => void;
}

interface Petal {
  x: number;
  y: number;
  size: number;
  speedY: number;
  speedX: number;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
}

const HomePage: React.FC<HomePageProps> = ({ onEnter }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const petalsRef = useRef<Petal[]>([]);
  const animationRef = useRef<number>(0);
  const cloudOffsetRef = useRef<number>(0);

  const createPetal = useCallback((width: number, height: number): Petal => {
    return {
      x: Math.random() * width,
      y: Math.random() * height - height,
      size: 3 + Math.random() * 3,
      speedY: 0.5 + Math.random() * 1,
      speedX: -0.3 + Math.random() * 0.6,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (0.5 + Math.random()) * 0.05,
      opacity: 0.6 + Math.random() * 0.4,
    };
  }, []);

  const drawPetal = useCallback((ctx: CanvasRenderingContext2D, petal: Petal) => {
    ctx.save();
    ctx.translate(petal.x, petal.y);
    ctx.rotate(petal.rotation);
    ctx.globalAlpha = petal.opacity;
    ctx.fillStyle = '#ffb7c5';
    ctx.beginPath();
    ctx.ellipse(0, 0, petal.size, petal.size * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff91a4';
    ctx.beginPath();
    ctx.ellipse(0, -petal.size * 0.2, petal.size * 0.3, petal.size * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, []);

  const drawCloud = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, scale: number) => {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(x, y, 25 * scale, 0, Math.PI * 2);
    ctx.arc(x + 30 * scale, y - 10 * scale, 30 * scale, 0, Math.PI * 2);
    ctx.arc(x + 60 * scale, y, 25 * scale, 0, Math.PI * 2);
    ctx.arc(x + 30 * scale, y + 10 * scale, 20 * scale, 0, Math.PI * 2);
    ctx.fill();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      petalsRef.current = [];
      for (let i = 0; i < 50; i++) {
        const petal = createPetal(canvas.width, canvas.height);
        petal.y = Math.random() * canvas.height;
        petalsRef.current.push(petal);
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      cloudOffsetRef.current += 0.3;
      const cloudY = canvas.height * 0.7;
      drawCloud(ctx, (cloudOffsetRef.current) % (canvas.width + 200) - 100, cloudY, 1.2);
      drawCloud(ctx, (cloudOffsetRef.current + 400) % (canvas.width + 200) - 100, cloudY + 30, 0.8);
      drawCloud(ctx, (cloudOffsetRef.current + 800) % (canvas.width + 200) - 100, cloudY - 20, 1);

      petalsRef.current.forEach((petal, index) => {
        petal.y += petal.speedY;
        petal.x += petal.speedX;
        petal.rotation += petal.rotationSpeed;

        if (petal.y > canvas.height + 20) {
          petalsRef.current[index] = createPetal(canvas.width, canvas.height);
          petalsRef.current[index].y = -20;
        }

        drawPetal(ctx, petal);
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationRef.current);
    };
  }, [createPetal, drawPetal, drawCloud]);

  return (
    <div style={styles.container}>
      <canvas ref={canvasRef} style={styles.canvas} />
      <div style={styles.content}>
        <div style={styles.plaque}>
          <div style={styles.plaqueInner}>
            <h1 style={styles.title}>玉露糕坊</h1>
            <div style={styles.decorationLine} />
            <p style={styles.subtitle}>匠心传承 · 古法糕点</p>
          </div>
        </div>
        <button style={styles.enterBtn} className="btn-ancient" onClick={onEnter}>
          进店选购
        </button>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    width: '100vw',
    height: '100vh',
    overflow: 'hidden',
    backgroundColor: '#f5e6d0',
  },
  canvas: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  content: {
    position: 'relative',
    zIndex: 10,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  plaque: {
    background: 'linear-gradient(180deg, #c0392b 0%, #8b0000 100%)',
    padding: '8px',
    borderRadius: '8px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.3), inset 0 2px 10px rgba(255,255,255,0.1)',
    marginBottom: '40px',
  },
  plaqueInner: {
    border: '3px solid #d4ac0d',
    padding: '40px 80px',
    borderRadius: '4px',
    backgroundColor: 'rgba(139, 0, 0, 0.3)',
  },
  title: {
    fontSize: '72px',
    color: '#d4ac0d',
    fontFamily: "'Ma Shan Zheng', cursive",
    textShadow: '2px 2px 4px rgba(0,0,0,0.3)',
    letterSpacing: '8px',
    marginBottom: '16px',
  },
  decorationLine: {
    height: '2px',
    background: 'linear-gradient(90deg, transparent, #d4ac0d, transparent)',
    marginBottom: '16px',
  },
  subtitle: {
    fontSize: '20px',
    color: '#f5e6d0',
    fontFamily: "'ZCOOL KuaiLe', cursive",
    letterSpacing: '4px',
    opacity: 0.9,
  },
  enterBtn: {
    fontSize: '24px',
    padding: '16px 48px',
  },
};

export default HomePage;
