import React, { useRef, useEffect, useState, useCallback } from 'react';
import type {
  Piece,
  DragState,
  Particle,
  HaloEffect,
  FormationType,
  GamePhase,
} from './types';
import {
  BOARD_SIZE,
  CELL_SIZE,
  PIECE_RADIUS,
  SNAP_DISTANCE,
  COLORS,
} from './types';
import {
  drawFeltBackground,
  drawGrid,
  drawPiece,
  drawHalo,
  drawParticle,
  drawCross,
  drawFormationText,
  drawResultBanner,
  easeOut,
  lerp,
  createInkParticles,
  updateParticles,
} from './CanvasRenderer';
import {
  snapToGrid,
  isValidPosition,
  checkCollisions,
  calculateMovement,
  isSimulationComplete,
  getSimulationResult,
  selectAiFormation,
  getFormationCenter,
  rearrangeFormation,
} from './GameSimulation';
import type { SimulationResult, CollisionEvent } from './GameSimulation';

interface BoardProps {
  pieces: Piece[];
  setPieces: React.Dispatch<React.SetStateAction<Piece[]>>;
  phase: GamePhase;
  setPhase: React.Dispatch<React.SetStateAction<GamePhase>>;
  playerFormation: FormationType | null;
  setPlayerFormation: React.Dispatch<React.SetStateAction<FormationType | null>>;
  aiFormation: FormationType | null;
  setAiFormation: React.Dispatch<React.SetStateAction<FormationType | null>>;
  result: SimulationResult | null;
  setResult: React.Dispatch<React.SetStateAction<SimulationResult | null>>;
  formationToApply: FormationType | null;
  onFormationApplied: () => void;
  onSimulationStart: () => void;
  scale: number;
  boardRef: React.RefObject<HTMLDivElement | null>;
}

const Board: React.FC<BoardProps> = ({
  pieces,
  setPieces,
  phase,
  setPhase,
  playerFormation,
  setPlayerFormation,
  aiFormation,
  setAiFormation,
  result,
  setResult,
  formationToApply,
  onFormationApplied,
  onSimulationStart,
  scale,
  boardRef,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    pieceId: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
  });
  const [halos, setHalos] = useState<HaloEffect[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [invalidPos, setInvalidPos] = useState<{ x: number; y: number } | null>(null);
  const [formationText, setFormationText] = useState<{
    text: string;
    startTime: number;
  } | null>(null);
  const [moveAnimations, setMoveAnimations] = useState<
    Map<
      string,
      { startX: number; startY: number; endX: number; endY: number; startTime: number }
    >
  >(new Map());
  const [resultBanner, setResultBanner] = useState<{
    text: string;
    subText: string;
    startTime: number;
  } | null>(null);

  const boardWidth = BOARD_SIZE * CELL_SIZE;
  const boardHeight = BOARD_SIZE * CELL_SIZE;

  useEffect(() => {
    const bgCanvas = bgCanvasRef.current;
    if (!bgCanvas) return;
    bgCanvas.width = boardWidth;
    bgCanvas.height = boardHeight;
    const bgCtx = bgCanvas.getContext('2d');
    if (bgCtx) {
      drawFeltBackground(bgCtx, boardWidth, boardHeight);
    }
  }, [boardWidth, boardHeight]);

  const getMousePos = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / scale,
        y: (e.clientY - rect.top) / scale,
      };
    },
    [scale]
  );

  const findPieceAtPos = useCallback(
    (x: number, y: number): Piece | null => {
      for (const piece of pieces) {
        if (piece.status === 'dead' || piece.side !== 'player') continue;
        const dist = Math.sqrt(
          Math.pow(piece.x - x, 2) + Math.pow(piece.y - y, 2)
        );
        if (dist <= PIECE_RADIUS) {
          return piece;
        }
      }
      return null;
    },
    [pieces]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (phase !== GamePhase.IDLE) return;
      const pos = getMousePos(e);
      const piece = findPieceAtPos(pos.x, pos.y);
      if (piece) {
        setDragState({
          isDragging: true,
          pieceId: piece.id,
          startX: piece.x,
          startY: piece.y,
          currentX: pos.x,
          currentY: pos.y,
        });
        setPhase(GamePhase.DRAGGING);
      }
    },
    [phase, getMousePos, findPieceAtPos, setPhase]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!dragState.isDragging || !dragState.pieceId) return;
      const pos = getMousePos(e);
      setDragState((prev) => ({
        ...prev,
        currentX: pos.x,
        currentY: pos.y,
      }));
    },
    [dragState.isDragging, dragState.pieceId, getMousePos]
  );

  const handleMouseUp = useCallback(() => {
    if (!dragState.isDragging || !dragState.pieceId) return;

    const snapped = snapToGrid(dragState.currentX, dragState.currentY);
    const dist = Math.sqrt(
      Math.pow(dragState.currentX - snapped.x, 2) +
        Math.pow(dragState.currentY - snapped.y, 2)
    );

    if (dist < SNAP_DISTANCE) {
      if (isValidPosition(pieces, dragState.pieceId, snapped.gridX, snapped.gridY)) {
        setPieces((prev) =>
          prev.map((p) =>
            p.id === dragState.pieceId
              ? { ...p, x: snapped.x, y: snapped.y, status: 'alive' }
              : p
          )
        );
        setHalos((prev) => [
          ...prev,
          {
            id: `halo-${Date.now()}`,
            x: snapped.x,
            y: snapped.y,
            startTime: Date.now(),
            duration: 300,
            color: COLORS.deepBlue,
            radius: 40,
          },
        ]);
      } else {
        setInvalidPos({ x: snapped.x, y: snapped.y });
        setTimeout(() => setInvalidPos(null), 500);
        setPieces((prev) =>
          prev.map((p) =>
            p.id === dragState.pieceId
              ? { ...p, x: dragState.startX, y: dragState.startY, status: 'alive' }
              : p
          )
        );
      }
    } else {
      setPieces((prev) =>
        prev.map((p) =>
          p.id === dragState.pieceId
            ? { ...p, x: dragState.startX, y: dragState.startY, status: 'alive' }
            : p
        )
      );
    }

    setDragState({
      isDragging: false,
      pieceId: null,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
    });
    setPhase(GamePhase.IDLE);
  }, [dragState, pieces, setPieces, setPhase]);

  useEffect(() => {
    if (!formationToApply) return;

    const center = getFormationCenter(pieces, 'player');
    const moveMap = rearrangeFormation(
      pieces,
      formationToApply,
      'player',
      center.gridX,
      center.gridY
    );

    const aiFormationType = selectAiFormation();
    const aiCenter = getFormationCenter(pieces, 'ai');
    const aiMoveMap = rearrangeFormation(
      pieces,
      aiFormationType,
      'ai',
      aiCenter.gridX,
      aiCenter.gridY
    );

    const newAnimations = new Map<
      string,
      { startX: number; startY: number; endX: number; endY: number; startTime: number }
    >();
    const now = Date.now();

    moveMap.forEach((target, id) => {
      const piece = pieces.find((p) => p.id === id);
      if (piece) {
        newAnimations.set(id, {
          startX: piece.x,
          startY: piece.y,
          endX: target.x,
          endY: target.y,
          startTime: now,
        });
      }
    });

    aiMoveMap.forEach((target, id) => {
      const piece = pieces.find((p) => p.id === id);
      if (piece) {
        newAnimations.set(id, {
          startX: piece.x,
          startY: piece.y,
          endX: target.x,
          endY: target.y,
          startTime: now,
        });
      }
    });

    setMoveAnimations(newAnimations);
    setPlayerFormation(formationToApply);
    setAiFormation(aiFormationType);
    setPhase(GamePhase.FORMING);

    const formation = formationToApply === 'yulin' ? '鱼鳞阵' :
                      formationToApply === 'fangyuan' ? '方圆阵' : '鹤翼阵';
    setFormationText({
      text: formation,
      startTime: now,
    });

    setTimeout(() => {
      const finalPieces = pieces.map((p) => {
        const anim = newAnimations.get(p.id);
        if (anim) {
          return { ...p, x: anim.endX, y: anim.endY, status: 'alive' as const };
        }
        return p;
      });
      setPieces(finalPieces);
      setMoveAnimations(new Map());
      setPhase(GamePhase.IDLE);
      onFormationApplied();
    }, 500);
  }, [formationToApply, pieces, setPieces, setPlayerFormation, setAiFormation, setPhase, onFormationApplied]);

  const handleStartSimulation = useCallback(() => {
    if (phase !== GamePhase.IDLE) return;
    if (!playerFormation || !aiFormation) {
      alert('请先选择阵法！');
      return;
    }
    setPhase(GamePhase.SIMULATING);
    setResultBanner(null);
    onSimulationStart();
  }, [phase, playerFormation, aiFormation, setPhase, onSimulationStart]);

  useEffect(() => {
    if (phase !== GamePhase.SIMULATING) return;

    const simulationStep = () => {
      setPieces((currentPieces) => {
        const dt = 1 / 60;
        let updated = calculateMovement(
          currentPieces,
          playerFormation,
          aiFormation,
          dt
        );

        const collisions = checkCollisions(updated);
        const newParticles: Particle[] = [];

        collisions.forEach((event: CollisionEvent) => {
          updated = updated.map((p) =>
            p.id === event.deadPieceId ? { ...p, status: 'dead' as const } : p
          );
          newParticles.push(...createInkParticles(event.x, event.y, 15));
        });

        if (newParticles.length > 0) {
          setParticles((prev) => [...prev, ...newParticles]);
        }

        if (isSimulationComplete(updated)) {
          const simResult = getSimulationResult(
            updated,
            playerFormation!,
            aiFormation!
          );
          setResult(simResult);

          const resultText =
            simResult.winner === 'player'
              ? '胜 利！'
              : simResult.winner === 'ai'
              ? '失 败！'
              : '平 局';
          const subText = `剩余兵力：我方 ${simResult.playerRemaining} / 敌方 ${simResult.aiRemaining}`;
          setResultBanner({
            text: resultText,
            subText,
            startTime: Date.now(),
          });

          setTimeout(() => {
            setPhase(GamePhase.FINISHED);
          }, 2000);

          return updated;
        }

        return updated;
      });
    };

    const interval = setInterval(simulationStep, 1000 / 60);
    return () => clearInterval(interval);
  }, [phase, playerFormation, aiFormation, setPieces, setResult, setPhase]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = boardWidth;
    canvas.height = boardHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = (timestamp: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp;
      const deltaTime = (timestamp - lastTimeRef.current) / 1000;
      lastTimeRef.current = timestamp;

      ctx.clearRect(0, 0, boardWidth, boardHeight);

      const bgCanvas = bgCanvasRef.current;
      if (bgCanvas) {
        ctx.drawImage(bgCanvas, 0, 0);
      }

      drawGrid(ctx, 1);

      const now = Date.now();
      const animatedPieces = pieces.map((p) => {
        const anim = moveAnimations.get(p.id);
        if (anim) {
          const t = Math.min(1, (now - anim.startTime) / 500);
          const eased = easeOut(t);
          return {
            ...p,
            x: lerp(anim.startX, anim.endX, eased),
            y: lerp(anim.startY, anim.endY, eased),
          };
        }
        return p;
      });

      animatedPieces.forEach((p) => {
        if (dragState.isDragging && p.id === dragState.pieceId) {
          drawPiece(ctx, { ...p, x: dragState.currentX, y: dragState.currentY }, 0.5);
        } else {
          drawPiece(ctx, p);
        }
      });

      setHalos((prev) => prev.filter((h) => now - h.startTime < h.duration));
      halos.forEach((h) => drawHalo(ctx, h, now));

      if (invalidPos) {
        drawCross(ctx, invalidPos.x, invalidPos.y, 30);
      }

      setParticles((prev) => updateParticles(prev, deltaTime));
      particles.forEach((p) => drawParticle(ctx, p, now));

      if (formationText) {
        const t = (now - formationText.startTime) / 2000;
        if (t < 1) {
          drawFormationText(
            ctx,
            formationText.text,
            boardWidth / 2,
            boardHeight / 2,
            t
          );
        } else {
          setFormationText(null);
        }
      }

      if (resultBanner) {
        const t = (now - resultBanner.startTime) / 2000;
        if (t < 1.5) {
          drawResultBanner(
            ctx,
            resultBanner.text,
            resultBanner.subText,
            boardWidth,
            t
          );
        }
      }

      animationRef.current = requestAnimationFrame(render);
    };

    animationRef.current = requestAnimationFrame(render);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [
    pieces,
    dragState,
    halos,
    particles,
    invalidPos,
    formationText,
    resultBanner,
    moveAnimations,
    boardWidth,
    boardHeight,
  ]);

  return (
    <div
      ref={boardRef}
      className="relative"
      style={{
        width: boardWidth * scale,
        height: boardHeight * scale,
        transformOrigin: 'top left',
      }}
    >
      <canvas
        ref={bgCanvasRef}
        className="absolute top-0 left-0"
        style={{
          width: boardWidth * scale,
          height: boardHeight * scale,
        }}
      />
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 cursor-pointer"
        style={{
          width: boardWidth * scale,
          height: boardHeight * scale,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      {phase === GamePhase.IDLE && result && (
        <button
          onClick={handleStartSimulation}
          className="absolute bottom-4 left-1/2 transform -translate-x-1/2 px-8 py-3 text-white font-bold rounded shadow-lg transition-all duration-100 hover:-translate-y-0.5 active:translate-y-0.5"
          style={{
            backgroundColor: COLORS.darkRed,
            fontFamily: '"Ma Shan Zheng", serif',
            fontSize: '18px',
          }}
        >
          开始推演
        </button>
      )}
    </div>
  );
};

export default Board;
