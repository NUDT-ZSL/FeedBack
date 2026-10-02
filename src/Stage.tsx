import React, { useRef, useEffect, useCallback } from 'react';
import { useStore, CharacterData } from './useStore';

interface StageProps {
  stageWidth: number;
  stageHeight: number;
}

const PUPPET_WIDTH = 50;
const PUPPET_HEIGHT = 90;

const characterPaths: Record<number, string> = {
  0: `M 25 5 Q 30 2 35 8 Q 40 5 42 12 Q 38 18 32 20 Q 28 22 25 25 Q 22 22 18 20 Q 12 18 8 12 Q 10 5 15 8 Q 20 2 25 5
      M 18 25 Q 15 35 12 50 Q 10 60 15 70 Q 20 75 25 72 Q 30 75 35 70 Q 40 60 38 50 Q 35 35 32 25
      M 8 40 Q 2 45 5 55 Q 8 60 15 55 Q 18 50 15 45 Q 12 40 8 40
      M 42 40 Q 48 45 45 55 Q 42 60 35 55 Q 32 50 35 45 Q 38 40 42 40
      M 22 72 Q 18 80 20 88 Q 22 90 24 88 Q 25 82 25 75
      M 28 72 Q 32 80 30 88 Q 28 90 26 88 Q 25 82 25 75`,
  1: `M 25 3 Q 32 0 38 6 Q 45 3 46 14 Q 40 22 32 25 Q 28 28 25 30 Q 22 28 18 25 Q 10 22 4 14 Q 5 3 12 6 Q 18 0 25 3
      M 16 28 Q 12 40 10 55 Q 8 70 14 80 Q 20 85 25 82 Q 30 85 36 80 Q 42 70 40 55 Q 38 40 34 28
      M 6 45 Q 0 52 3 62 Q 6 68 14 62 Q 18 55 14 50 Q 10 45 6 45
      M 44 45 Q 50 52 47 62 Q 44 68 36 62 Q 32 55 36 50 Q 40 45 44 45
      M 20 82 Q 15 86 17 92 Q 20 95 23 92 Q 25 88 25 85
      M 30 82 Q 35 86 33 92 Q 30 95 27 92 Q 25 88 25 85`,
  2: `M 25 8 Q 32 4 37 10 Q 44 7 46 16 Q 40 24 32 26 Q 28 28 25 30 Q 22 28 18 26 Q 10 24 4 16 Q 6 7 13 10 Q 18 4 25 8
      M 15 28 Q 11 42 9 58 Q 7 72 13 82 Q 20 87 25 84 Q 30 87 37 82 Q 43 72 41 58 Q 39 42 35 28
      M 5 42 Q -2 50 1 60 Q 4 66 12 60 Q 16 53 12 48 Q 8 42 5 42
      M 45 42 Q 52 50 49 60 Q 46 66 38 60 Q 34 53 38 48 Q 42 42 45 42
      M 22 84 Q 16 88 18 94 Q 21 96 24 94 Q 25 89 25 86
      M 28 84 Q 34 88 32 94 Q 29 96 26 94 Q 25 89 25 86`,
};

const Stage: React.FC<StageProps> = ({ stageWidth, stageHeight }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lightDragging = useRef(false);
  const animFrameRef = useRef<number>();
  const lastRenderRef = useRef<number>(0);

  const {
    lightSource,
    characters,
    selectedCharacter,
    setLightSource,
    setSelectedCharacter,
    setCharacterPosition,
  } = useStore();

  const drawBambooTexture = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = '#5d3a1a';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#4a2c10';
    for (let i = 0; i < w; i += 25) {
      ctx.fillRect(x + i, y, 3, h);
      ctx.fillRect(x + i + 8, y + 1, 2, h - 2);
    }
  }, []);

  const drawCurtainTexture = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#f5f0e6');
    gradient.addColorStop(0.5, '#ebe4d4');
    gradient.addColorStop(1, '#f5f0e6');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    ctx.globalAlpha = 0.03;
    ctx.strokeStyle = '#8b7355';
    ctx.lineWidth = 1;
    for (let i = 0; i < w; i += 3) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 2, h);
      ctx.stroke();
    }
    for (let i = 0; i < h; i += 3) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(w, i + 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, []);

  const calculateShadowTransform = useCallback((
    charX: number,
    charY: number,
    charScale: number,
    lightX: number,
    lightY: number,
    centerX: number,
    centerY: number
  ) => {
    const dx = centerX + charX - lightX;
    const dy = centerY + charY - lightY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const clampedDistance = Math.max(30, distance);

    const shadowScale = 1 + (300 / clampedDistance) * 0.5;
    const blurRadius = Math.min(12, (1 / clampedDistance) * 1800);
    const offsetX = dx * 0.15;
    const offsetY = dy * 0.1;

    return {
      scale: shadowScale * charScale,
      blur: blurRadius,
      offsetX,
      offsetY,
      distance: clampedDistance,
    };
  }, []);

  const drawPuppetShadow = useCallback((
    ctx: CanvasRenderingContext2D,
    charIndex: number,
    char: CharacterData,
    lightX: number,
    lightY: number,
    centerX: number,
    centerY: number,
    isSelected: boolean
  ) => {
    const transform = calculateShadowTransform(
      char.x, char.y, char.scale,
      lightX, lightY,
      centerX, centerY
    );

    const shadowX = centerX + char.x + transform.offsetX;
    const shadowY = centerY + char.y + transform.offsetY;

    ctx.save();
    ctx.translate(shadowX - PUPPET_WIDTH / 2, shadowY - PUPPET_HEIGHT / 2);
    ctx.translate(PUPPET_WIDTH / 2, PUPPET_HEIGHT / 2);
    ctx.rotate((char.rotation * Math.PI) / 180);
    ctx.scale(transform.scale * (char.flipY < 0 ? -1 : 1), transform.scale);
    ctx.translate(-PUPPET_WIDTH / 2, -PUPPET_HEIGHT / 2);

    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = transform.blur;
    ctx.fillStyle = '#000000';

    const path = new Path2D(characterPaths[charIndex]);
    ctx.fill(path);

    if (isSelected) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke(path);
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [calculateShadowTransform]);

  const drawLightSource = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, 24);
    gradient.addColorStop(0, 'rgba(255, 215, 0, 0.95)');
    gradient.addColorStop(0.3, 'rgba(255, 200, 0, 0.6)');
    gradient.addColorStop(0.6, 'rgba(255, 180, 0, 0.25)');
    gradient.addColorStop(1, 'rgba(255, 150, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, 24, 0, Math.PI * 2);
    ctx.fill();

    const coreGradient = ctx.createRadialGradient(x, y, 0, x, y, 12);
    coreGradient.addColorStop(0, '#fff8dc');
    coreGradient.addColorStop(0.4, '#ffd700');
    coreGradient.addColorStop(1, '#ff8c00');

    ctx.fillStyle = coreGradient;
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(139, 69, 19, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.stroke();
  }, []);

  const render = useCallback(() => {
    const now = performance.now();
    if (now - lastRenderRef.current < 16) return;
    lastRenderRef.current = now;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, stageWidth, stageHeight);

    const curtainTop = 60;
    const curtainLeft = 40;
    const curtainW = stageWidth - 80;
    const curtainH = stageHeight - 140;
    const centerX = curtainLeft + curtainW / 2;
    const centerY = curtainTop + curtainH / 2;

    ctx.fillStyle = '#6b4e3a';
    ctx.fillRect(0, stageHeight - 80, stageWidth, 80);
    ctx.fillStyle = '#5a4230';
    for (let i = 0; i < stageWidth; i += 60) {
      ctx.fillRect(i, stageHeight - 80, 2, 80);
    }

    ctx.fillStyle = '#5d3a1a';
    ctx.fillRect(15, 30, 25, stageHeight - 30);
    ctx.fillRect(stageWidth - 40, 30, 25, stageHeight - 30);

    drawBambooTexture(ctx, 20, 34, stageWidth - 40, 6);

    ctx.save();
    ctx.beginPath();
    ctx.rect(curtainLeft, curtainTop, curtainW, curtainH);
    ctx.clip();

    drawCurtainTexture(ctx, curtainW, curtainH);

    for (let i = 0; i < characters.length; i++) {
      const char = characters[i];
      if (char.x !== 0 || char.y !== 0 || char.scale !== 1.0 || selectedCharacter === i) {
        drawPuppetShadow(
          ctx, i, char,
          lightSource.x, lightSource.y,
          centerX, centerY,
          selectedCharacter === i
        );
      }
    }

    ctx.restore();

    ctx.strokeStyle = '#5d3a1a';
    ctx.lineWidth = 4;
    ctx.strokeRect(curtainLeft, curtainTop, curtainW, curtainH);

    drawLightSource(ctx, lightSource.x, lightSource.y);
  }, [stageWidth, stageHeight, lightSource, characters, selectedCharacter, drawBambooTexture, drawCurtainTexture, drawPuppetShadow, drawLightSource]);

  useEffect(() => {
    const animate = () => {
      render();
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [render]);

  const getCanvasCoords = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX: number, clientY: number;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    const { x, y } = getCanvasCoords(e);
    const dx = x - lightSource.x;
    const dy = y - lightSource.y;
    if (Math.sqrt(dx * dx + dy * dy) < 30) {
      lightDragging.current = true;
      e.preventDefault();
      return;
    }

    const curtainLeft = 40;
    const curtainTop = 60;
    const curtainW = stageWidth - 80;
    const curtainH = stageHeight - 140;
    const centerX = curtainLeft + curtainW / 2;
    const centerY = curtainTop + curtainH / 2;

    if (selectedCharacter !== null &&
        x >= curtainLeft && x <= curtainLeft + curtainW &&
        y >= curtainTop && y <= curtainTop + curtainH) {
      const newX = Math.max(-150, Math.min(150, x - centerX));
      const newY = Math.max(-100, Math.min(100, y - centerY));
      setCharacterPosition(selectedCharacter, newX, newY);
    }
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!lightDragging.current) return;
    const { x, y } = getCanvasCoords(e);
    const clampedX = Math.max(30, Math.min(stageWidth - 30, x));
    const clampedY = Math.max(30, Math.min(stageHeight - 30, y));
    setLightSource(clampedX, clampedY);
    e.preventDefault();
  };

  const handlePointerUp = () => {
    lightDragging.current = false;
  };

  return (
    <canvas
      ref={canvasRef}
      width={stageWidth}
      height={stageHeight}
      onMouseDown={handlePointerDown}
      onMouseMove={handlePointerMove}
      onMouseUp={handlePointerUp}
      onMouseLeave={handlePointerUp}
      onTouchStart={handlePointerDown}
      onTouchMove={handlePointerMove}
      onTouchEnd={handlePointerUp}
      onClick={() => setSelectedCharacter(null)}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        cursor: lightDragging.current ? 'grabbing' : 'default',
        touchAction: 'none',
      }}
    />
  );
};

export default Stage;
