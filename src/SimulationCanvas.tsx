import React, { useRef, useEffect, useCallback } from 'react';
import {
  BallState,
  updateBallPhysics,
  handleElasticCollision,
  calculateTotalMomentum,
  calculateTotalKineticEnergy,
  getBallRadius,
  interpolateColor,
} from './PhysicsEngine';

interface SimulationCanvasProps {
  ballCount: number;
  masses: number[];
  damping: number;
  paused: boolean;
  onTogglePause: () => void;
  resetTrigger: number;
  onPhysicsUpdate: (momentum: number, energy: number) => void;
  ripples: { id: number; x: number; y: number; progress: number }[];
  onRippleComplete: (id: number) => void;
}

const PIVOT_Y = 120;
const ROPE_LENGTH = 220;
const BALL_SPACING = 40;

const SimulationCanvas: React.FC<SimulationCanvasProps> = ({
  ballCount,
  masses,
  damping,
  paused,
  onTogglePause,
  resetTrigger,
  onPhysicsUpdate,
  ripples,
  onRippleComplete: _onRippleComplete,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ballsRef = useRef<BallState[]>([]);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const draggingRef = useRef<{ index: number; startAngle: number } | null>(null);
  const sizeRef = useRef({ width: 800, height: 600 });
  const massAnimRef = useRef<{ current: number[]; target: number[]; startTime: number }>({
    current: [],
    target: [],
    startTime: 0,
  });

  const initBalls = useCallback((count: number, currentMasses: number[]) => {
    const balls: BallState[] = [];
    const totalWidth = (count - 1) * BALL_SPACING;
    const centerX = sizeRef.current.width / 2;
    const startX = centerX - totalWidth / 2;

    for (let i = 0; i < count; i++) {
      const mass = currentMasses[i] || 1;
      const radius = getBallRadius(mass);
      const pivotX = startX + i * BALL_SPACING;
      balls.push({
        angle: 0,
        angularVelocity: 0,
        mass,
        x: pivotX,
        y: PIVOT_Y + ROPE_LENGTH,
        pivotX,
        pivotY: PIVOT_Y,
        ropeLength: ROPE_LENGTH,
        radius,
        flashTime: 0,
        trail: [],
        targetAngle: 0,
        isResetting: false,
        resetProgress: 0,
      });
    }
    ballsRef.current = balls;
    massAnimRef.current = {
      current: [...currentMasses.slice(0, count)],
      target: [...currentMasses.slice(0, count)],
      startTime: 0,
    };
  }, []);

  useEffect(() => {
    const currentMasses = masses.slice(0, ballCount);
    while (currentMasses.length < ballCount) currentMasses.push(1);

    massAnimRef.current.target = [...currentMasses];
    massAnimRef.current.startTime = performance.now();

    if (ballsRef.current.length !== ballCount) {
      initBalls(ballCount, currentMasses);
    }
  }, [ballCount, masses, initBalls]);

  useEffect(() => {
    if (ballsRef.current.length === 0) {
      initBalls(ballCount, masses);
    }
  }, [ballCount, masses, initBalls]);

  useEffect(() => {
    if (resetTrigger > 0) {
      for (const ball of ballsRef.current) {
        ball.targetAngle = 0;
        ball.isResetting = true;
        ball.resetProgress = 0;
      }
    }
  }, [resetTrigger]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        onTogglePause();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onTogglePause]);

  const getCanvasCoords = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    let clientX: number, clientY: number;
    if ('touches' in e) {
      clientX = e.touches[0]?.clientX || 0;
      clientY = e.touches[0]?.clientY || 0;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: ((clientX - rect.left) / rect.width) * sizeRef.current.width,
      y: ((clientY - rect.top) / rect.height) * sizeRef.current.height,
    };
  }, []);

  const handlePointerDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (paused) return;
    const { x, y } = getCanvasCoords(e);

    for (let i = 0; i < ballsRef.current.length; i++) {
      const ball = ballsRef.current[i];
      const dx = x - ball.x;
      const dy = y - ball.y;
      if (dx * dx + dy * dy <= ball.radius * ball.radius * 1.5) {
        draggingRef.current = { index: i, startAngle: ball.angle };
        ball.angularVelocity = 0;
        break;
      }
    }
  }, [paused, getCanvasCoords]);

  const handlePointerMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!draggingRef.current || paused) return;
    const { x, y } = getCanvasCoords(e);
    const ball = ballsRef.current[draggingRef.current.index];

    const dx = x - ball.pivotX;
    const dy = y - ball.pivotY;
    let angle = Math.atan2(dx, dy);
    const maxAngle = Math.PI * 0.7;
    angle = Math.max(-maxAngle, Math.min(maxAngle, angle));

    ball.angle = angle;
    ball.angularVelocity = 0;
    ball.x = ball.pivotX + Math.sin(angle) * ball.ropeLength;
    ball.y = ball.pivotY + Math.cos(angle) * ball.ropeLength;
  }, [paused, getCanvasCoords]);

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  const render = useCallback((ctx: CanvasRenderingContext2D) => {
    const { width, height } = sizeRef.current;
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, width, height);

    const balls = ballsRef.current;

    for (const ball of balls) {
      if (ball.trail.length > 1) {
        ctx.beginPath();
        ctx.moveTo(ball.trail[0].x, ball.trail[0].y);
        for (let i = 1; i < ball.trail.length; i++) {
          const alpha = 0.2 * (i / ball.trail.length);
          ctx.strokeStyle = `rgba(158, 158, 158, ${alpha})`;
          ctx.lineWidth = 2;
          ctx.lineTo(ball.trail[i].x, ball.trail[i].y);
        }
        ctx.stroke();
      }
    }

    for (const ball of balls) {
      ctx.beginPath();
      ctx.moveTo(ball.pivotX, ball.pivotY);
      ctx.lineTo(ball.x, ball.y);
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(ball.pivotX, ball.pivotY, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#455a64';
      ctx.fill();
    }

    const beamStartX = balls[0]?.pivotX - 20 || 0;
    const beamEndX = balls[balls.length - 1]?.pivotX + 20 || 0;
    ctx.fillStyle = '#37474f';
    ctx.fillRect(beamStartX, PIVOT_Y - 15, beamEndX - beamStartX, 8);

    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      const massT = (ball.mass - 0.5) / 4.5;
      const baseColor = interpolateColor(Math.max(0, Math.min(1, massT)));

      const grad = ctx.createRadialGradient(
        ball.x - ball.radius * 0.3,
        ball.y - ball.radius * 0.3,
        ball.radius * 0.1,
        ball.x,
        ball.y,
        ball.radius
      );

      const parseColor = (c: string) => {
        const m = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (m) return { r: +m[1], g: +m[2], b: +m[3] };
        return { r: 212, g: 212, b: 212 };
      };
      const col = parseColor(baseColor);
      const lightR = Math.min(255, col.r + 40);
      const lightG = Math.min(255, col.g + 40);
      const lightB = Math.min(255, col.b + 40);
      const darkR = Math.max(0, col.r - 60);
      const darkG = Math.max(0, col.g - 60);
      const darkB = Math.max(0, col.b - 60);

      grad.addColorStop(0, `rgb(${lightR}, ${lightG}, ${lightB})`);
      grad.addColorStop(0.5, baseColor);
      grad.addColorStop(1, `rgb(${darkR}, ${darkG}, ${darkB})`);

      ctx.save();
      if (paused) {
        ctx.globalAlpha = 0.6;
      }
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      if (ball.flashTime > 0) {
        const flashAlpha = 0.2 + (ball.flashTime / 0.2) * 0.6;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.radius + 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
        ctx.fill();
      }
      ctx.restore();
    }

    for (const ripple of ripples) {
      const maxRadius = 120;
      const r = ripple.progress * maxRadius;
      const alpha = 0.5 * (1 - ripple.progress);
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    const momentum = calculateTotalMomentum(balls);
    const energy = calculateTotalKineticEnergy(balls);
    onPhysicsUpdate(momentum, energy);

    ctx.font = '12px monospace';
    ctx.fillStyle = '#546e7a';
    ctx.textAlign = 'left';
    ctx.fillText(`总动量: ${momentum.toFixed(2)} kg·m/s`, 16, 28);
    ctx.fillText(`总动能: ${energy.toFixed(2)} J`, 16, 48);

    if (paused) {
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = '#ff7043';
      ctx.fillText('[ 已暂停 - 按空格继续 ]', 16, 72);
    }
  }, [paused, damping, ripples, onPhysicsUpdate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        const w = parent.clientWidth;
        const h = Math.max(600, parent.clientHeight);
        sizeRef.current = { width: w, height: h };
        canvas.width = w * window.devicePixelRatio;
        canvas.height = h * window.devicePixelRatio;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

        if (ballsRef.current.length > 0) {
          const totalWidth = (ballsRef.current.length - 1) * BALL_SPACING;
          const centerX = w / 2;
          const startX = centerX - totalWidth / 2;
          ballsRef.current.forEach((ball, i) => {
            ball.pivotX = startX + i * BALL_SPACING;
            ball.x = ball.pivotX + Math.sin(ball.angle) * ball.ropeLength;
            ball.y = ball.pivotY + Math.cos(ball.angle) * ball.ropeLength;
          });
        }
      }
    };
    resize();
    window.addEventListener('resize', resize);

    const animate = (time: number) => {
      const dt = Math.min(0.033, (time - lastTimeRef.current) / 1000 || 0.016);
      lastTimeRef.current = time;

      if (!paused) {
        const balls = ballsRef.current;
        const maxTrail = damping <= 0.001 ? 200 : Math.max(20, Math.floor(200 * (1 - damping / 0.05)));

        const anim = massAnimRef.current;
        const animT = Math.min(1, (time - anim.startTime) / 150);
        if (animT < 1 && anim.current.length === anim.target.length) {
          for (let i = 0; i < anim.current.length; i++) {
            anim.current[i] = anim.current[i] + (anim.target[i] - anim.current[i]) * 0.15;
            if (balls[i]) {
              balls[i].mass = anim.current[i];
              balls[i].radius = getBallRadius(anim.current[i]);
            }
          }
        } else if (anim.current.length === anim.target.length) {
          for (let i = 0; i < anim.current.length; i++) {
            anim.current[i] = anim.target[i];
            if (balls[i]) {
              balls[i].mass = anim.current[i];
              balls[i].radius = getBallRadius(anim.current[i]);
            }
          }
        }

        for (let i = 0; i < balls.length; i++) {
          if (draggingRef.current && draggingRef.current.index === i) continue;
          updateBallPhysics(balls[i], dt, damping, maxTrail);
        }

        for (let pass = 0; pass < 3; pass++) {
          for (let i = 0; i < balls.length - 1; i++) {
            handleElasticCollision(balls[i], balls[i + 1]);
          }
        }
      }

      render(ctx);
      rafRef.current = requestAnimationFrame(animate);
    };

    lastTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [paused, damping, render]);

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={handlePointerDown}
      onMouseMove={handlePointerMove}
      onMouseUp={handlePointerUp}
      onMouseLeave={handlePointerUp}
      onTouchStart={handlePointerDown}
      onTouchMove={handlePointerMove}
      onTouchEnd={handlePointerUp}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        minHeight: '600px',
        cursor: draggingRef.current ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
    />
  );
};

export default SimulationCanvas;
