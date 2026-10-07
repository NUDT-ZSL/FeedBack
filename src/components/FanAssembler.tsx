import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useFanStore } from '../store/useFanStore';
import { inventoryApi } from '../api/orderApi';
import { playBambooClick, playErrorSound, playPaperRub, playSuccessSound } from '../utils/audio';
import { FanRib, COLORS } from '../types';

const FAN_RADIUS = 200;
const CENTER = { x: 250, y: 280 };
const TOTAL_RIBS = 12;
const DAMPING = 0.8;

export default function FanAssembler() {
  const {
    currentFanSurface,
    fanRibs,
    assembledRibs,
    assemblyComplete,
    fan展开Angle,
    show合扇Animation,
    addAssembledRib,
    clearAssembly,
    trigger合扇Animation,
    complete合扇Animation,
    setFan展开Angle,
    showNotification,
    setFanRibs,
  } = useFanStore();

  const [draggingRib, setDraggingRib] = useState<FanRib | null>(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [velocity, setVelocity] = useState({ x: 0, y: 0 });
  const [errorSlot, setErrorSlot] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>();
  const lastPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const loadInventory = async () => {
      try {
        setFanRibs(await inventoryApi.getFanRibs());
      } catch {
        showNotification('扇骨库存加载失败，请稍后重试', 'error');
      }
    };
    loadInventory();
  }, [setFanRibs, showNotification]);

  useEffect(() => {
    if (assemblyComplete && !show合扇Animation) {
      trigger合扇Animation();
      playPaperRub();
      playSuccessSound();
      const start = Date.now();
      const animate = () => {
        const t = (Date.now() - start) / 2000;
        if (t < 1) {
          const phase = t < 0.5 ? t * 2 : 2 - t * 2;
          setFan展开Angle(140 * (1 - phase * 0.7));
          animRef.current = requestAnimationFrame(animate);
        } else {
          setFan展开Angle(140);
          complete合扇Animation();
        }
      };
      animRef.current = requestAnimationFrame(animate);
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [assemblyComplete, show合扇Animation, trigger合扇Animation, complete合扇Animation, setFan展开Angle]);

  const getSlotPosition = useCallback(
    (index: number) => {
      const startAngle = -fan展开Angle / 2;
      const angleStep = fan展开Angle / (TOTAL_RIBS - 1);
      const angle = (startAngle + index * angleStep) * (Math.PI / 180);
      return { x: CENTER.x + FAN_RADIUS * Math.sin(angle), y: CENTER.y - FAN_RADIUS * Math.cos(angle), angle };
    },
    [fan展开Angle]
  );

  const getExpectedNext = () => assembledRibs.length + 1;

  const handleDragStart = (e: React.PointerEvent, rib: FanRib) => {
    if (rib.quantity <= 0 || rib.used) return;
    e.preventDefault();
    setDraggingRib(rib);
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setDragPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      lastPos.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleDragMove = (e: React.PointerEvent) => {
    if (!draggingRib) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    setVelocity({ x: cx - lastPos.current.x, y: cy - lastPos.current.y });
    setDragPos({ x: cx + velocity.x * DAMPING, y: cy + velocity.y * DAMPING });
    lastPos.current = { x: cx, y: cy };
  };

  const handleDragEnd = async (e: React.PointerEvent) => {
    if (!draggingRib) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ex = e.clientX - rect.left;
    const ey = e.clientY - rect.top;

    let nearest = -1;
    let minDist = Infinity;
    for (let i = 0; i < TOTAL_RIBS; i++) {
      if (assembledRibs.some((r) => r.positionIndex === i)) continue;
      const slot = getSlotPosition(i);
      const dist = Math.sqrt((ex - slot.x) ** 2 + (ey - slot.y) ** 2);
      if (dist < minDist && dist < 50) {
        minDist = dist;
        nearest = i;
      }
    }

    if (nearest >= 0) {
      if (draggingRib.number !== getExpectedNext()) {
        setErrorSlot(nearest);
        playErrorSound();
        showNotification(`请按顺序组装，下一根应为第 ${getExpectedNext()} 号`, 'error');
        setTimeout(() => setErrorSlot(null), 300);
      } else {
        try {
          const { fanRibs: latestRibs } = await inventoryApi.useFanRib(draggingRib.id);
          setFanRibs(latestRibs);
          addAssembledRib(draggingRib.id, nearest);
          playBambooClick();
        } catch {
          showNotification('扇骨库存扣减失败，请重试', 'error');
          playErrorSound();
        }
      }
    }
    setDraggingRib(null);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const renderRib = (rib: FanRib, isDragging = false, angle = 0, pos?: { x: number; y: number }) => {
    const qty = rib.quantity;
    const disabled = qty <= 0 || rib.used;
    const rotate = isDragging ? 2 : angle * (180 / Math.PI);
    const x = pos?.x ?? 0;
    const y = pos?.y ?? 0;

    return (
      <motion.div
        key={rib.id}
        className={`absolute cursor-grab active:cursor-grabbing ${disabled ? 'pointer-events-none' : ''}`}
        style={{ opacity: disabled ? 0.3 : 1, left: isDragging ? x - 8 : undefined, top: isDragging ? y - 100 : undefined, zIndex: isDragging ? 100 : 1 }}
        animate={isDragging ? { x: 0, y: 0, rotate } : { rotate }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        onPointerDown={(e) => handleDragStart(e, rib)}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        <div className="relative">
          <div
            className="w-4 h-48 rounded-sm"
            style={{ background: 'linear-gradient(90deg, #a67c52 0%, #c49a6c 30%, #a67c52 50%, #8b6914 70%, #a67c52 100%)', boxShadow: 'inset 2px 0 4px rgba(0,0,0,0.2), inset -2px 0 4px rgba(255,255,255,0.1)' }}
          >
            <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(139,105,20,0.3) 2px, rgba(139,105,20,0.3) 3px)' }} />
          </div>
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-[#d4a017] border-2 border-[#8b6914] flex items-center justify-center text-[10px] font-bold text-[#1a1a1a]">{rib.number}</div>
          {!isDragging && <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-[#6b4e3a] font-medium whitespace-nowrap">库存: {qty}</div>}
        </div>
      </motion.div>
    );
  };

  const getFanPath = () => {
    const startRad = (-fan展开Angle / 2) * (Math.PI / 180);
    const endRad = (fan展开Angle / 2) * (Math.PI / 180);
    const x1 = CENTER.x + FAN_RADIUS * Math.sin(startRad);
    const y1 = CENTER.y - FAN_RADIUS * Math.cos(startRad);
    const x2 = CENTER.x + FAN_RADIUS * Math.sin(endRad);
    const y2 = CENTER.y - FAN_RADIUS * Math.cos(endRad);
    return `M ${CENTER.x} ${CENTER.y} L ${x1} ${y1} A ${FAN_RADIUS} ${FAN_RADIUS} 0 ${fan展开Angle > 180 ? 1 : 0} 1 ${x2} ${y2} Z`;
  };

  return (
    <div className="paper-texture rounded-lg border-4 p-4 overflow-hidden" style={{ borderColor: COLORS.wood }}>
      <div ref={containerRef} className="relative mx-auto" style={{ width: 500, height: 560 }}>
        <svg width={500} height={560} className="absolute inset-0">
          <path
            d={getFanPath()}
            fill={currentFanSurface ? COLORS.cream : '#efe6d2'}
            stroke={COLORS.wood}
            strokeWidth={3}
            opacity={currentFanSurface ? 1 : 0.5}
          />
        </svg>

        {Array.from({ length: TOTAL_RIBS }).map((_, i) => {
          if (assembledRibs.some((r) => r.positionIndex === i)) return null;
          const slot = getSlotPosition(i);
          return (
            <div
              key={`slot-${i}`}
              className={`absolute w-5 h-5 rounded-full border-2 border-dashed transition-colors ${
                errorSlot === i ? 'border-red-500 bg-red-100' : 'border-amber-700/40'
              }`}
              style={{ left: slot.x - 10, top: slot.y - 10 }}
            />
          );
        })}

        {assembledRibs.map(({ ribId, positionIndex }) => {
          const slot = getSlotPosition(positionIndex);
          return (
            <div
              key={ribId}
              className="absolute w-3 rounded-sm"
              style={{
                left: CENTER.x - 6,
                top: CENTER.y - FAN_RADIUS,
                height: FAN_RADIUS,
                transformOrigin: '50% 100%',
                transform: `rotate(${(slot.angle * 180) / Math.PI}deg)`,
                background: 'linear-gradient(90deg, #a67c52 0%, #c49a6c 30%, #a67c52 50%, #8b6914 70%, #a67c52 100%)',
                boxShadow: 'inset 1px 0 2px rgba(0,0,0,0.2)',
              }}
            />
          );
        })}

        <div
          className="absolute w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold"
          style={{ left: CENTER.x - 16, top: CENTER.y - 16, backgroundColor: COLORS.gold, borderColor: '#8b6914' }}
        >
          轴
        </div>

        <div className="absolute bottom-0 left-0 right-0 flex justify-center gap-1">
          {fanRibs.map((rib) => (
            <div key={rib.id} className="relative w-8 h-60">
              {renderRib(rib)}
            </div>
          ))}
        </div>

        {draggingRib && renderRib(draggingRib, true, 0, dragPos)}
      </div>

      <div className="text-center text-sm font-medium mt-2" style={{ color: COLORS.wood }}>
        {assemblyComplete
          ? '扇骨组装完成，正在合扇…'
          : `按顺序拖拽扇骨到对应点位（下一根：第 ${getExpectedNext()} 号）`}
      </div>
      {assembledRibs.length > 0 && !assemblyComplete && (
        <button
          onClick={clearAssembly}
          className="absolute top-3 right-3 px-3 py-1 rounded text-sm text-white hover:opacity-90"
          style={{ backgroundColor: COLORS.wood }}
        >
          重新组装
        </button>
      )}
    </div>
  );
}
