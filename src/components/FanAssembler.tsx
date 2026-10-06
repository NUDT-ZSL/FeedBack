import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFanStore } from '../store/useFanStore';
import { inventoryApi } from '../api/orderApi';
import { playBambooClick, playErrorSound, playPaperRub, playSuccessSound } from '../utils/audio';
import { FanRib } from '../types';

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
    updateFanRib,
  } = useFanStore();

  const [draggingRib, setDraggingRib] = useState<FanRib | null>(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [velocity, setVelocity] = useState({ x: 0, y: 0 });
  const [errorSlot, setErrorSlot] = useState<number | null>(null);

  // 库存数量只认共享总账（store.fanRibs），与订单页、库存页保持一致
  const inventory = useMemo(() => {
    const inv: Record<number, number> = {};
    fanRibs.forEach((r) => (inv[r.number] = r.quantity));
    return inv;
  }, [fanRibs]);

  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>();
  const lastPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const loadInventory = async () => {
      try {
        const ribs = await inventoryApi.getFanRibs();
        setFanRibs(ribs);
      } catch {
        const ribs: FanRib[] = [];
        for (let i = 1; i <= TOTAL_RIBS; i++) {
          ribs.push({ id: `rib-${i}`, number: i, material: 'bamboo', color: '#a67c52', inStock: true, used: false, quantity: 0 });
        }
        setFanRibs(ribs);
      }
    };
    loadInventory();
  }, [setFanRibs]);

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
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
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
    if (inventory[rib.number] <= 0 || rib.used) return;
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
          const updated = await inventoryApi.useFanRib(draggingRib.id);
          updateFanRib(updated);
          addAssembledRib(draggingRib.id, nearest);
          playBambooClick();
        } catch {
          playErrorSound();
          showNotification(`第 ${draggingRib.number} 号扇骨库存不足，无法组装`, 'error');
        }
      }
    }
    setDraggingRib(null);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const renderRib = (rib: FanRib, isDragging = false, angle = 0, pos?: { x: number; y: number }) => {
    const qty = inventory[rib.number] || 0;
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
    <div ref={containerRef} className="relative w-full h-full paper-texture rounded-lg border-4 p-4 overflow-hidden" style={{
borderColor: '#6b4e3a', minHeight: 620, backgroundColor: '#faf6e9' }}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-xl font-bold text-[#6b4e3a]">扇骨组装</h2>
          <p className="text-xs text-gray-500 mt-1">
            按编号顺序拖拽扇骨到扇面连接点 · 已装 {assembledRibs.length}/{TOTAL_RIBS}
          </p>
        </div>
        <button onClick={clearAssembly}
          className="px-3 py-1.5 bg-[#6b4e3a] text-[#f5e6d3] rounded text-sm hover:opacity-90">
          <i className="fa-solid fa-rotate-left mr-1" />重新组装
        </button>
      </div>

      <svg viewBox="0 0 500 560" className="w-full max-w-xl mx-auto block" style={{ height: 380 }}>
        <path d={getFanPath()} fill="#f5e6d3" stroke="#6b4e3a" strokeWidth="3" opacity="0.9" />
        {Array.from({ length: TOTAL_RIBS }, (_, i) => {
          const slot = getSlotPosition(i);
          const occupied = assembledRibs.some((r) => r.positionIndex === i);
          return (
            <g key={i}>
              {occupied && (
                <line x1={CENTER.x} y1={CENTER.y} x2={slot.x} y2={slot.y}
                  stroke="#a67c52" strokeWidth="5" strokeLinecap="round" />
              )}
              <circle cx={slot.x} cy={slot.y} r="9"
                fill={occupied ? '#a67c52' : errorSlot === i ? '#c0392b' : '#ffffff'}
                stroke={errorSlot === i ? '#c0392b' : '#6b4e3a'} strokeWidth="2"
                opacity={occupied ? 1 : 0.7}>
                {errorSlot === i && (
                  <animate attributeName="opacity" values="1;0.2;1" dur="0.3s" repeatCount="2" />
                )}
              </circle>
              {!occupied && (
                <text x={slot.x} y={slot.y + 3.5} textAnchor="middle" fontSize="9" fill="#6b4e3a">
                  {i + 1}
                </text>
              )}
            </g>
          );
        })}
        <circle cx={CENTER.x} cy={CENTER.y} r="10" fill="#d4a017" stroke="#8b6914" strokeWidth="2" />
      </svg>

      {assemblyComplete && (
        <div className="text-center text-sm text-[#4a7c59] font-medium my-2">
          <i className="fa-solid fa-circle-check mr-1" />十二根扇骨俱已归位，绢扇开合自如
        </div>
      )}

      <div className="mt-4 pt-6 pb-8 border-t border-[#6b4e3a]/20">
        <p className="text-xs text-gray-500 mb-2">扇骨库（下一根应为第 {getExpectedNext()} 号）</p>
        <div className="flex flex-wrap justify-center gap-3">
          {fanRibs.map((rib) => (
            <div key={rib.id} className="relative w-8 h-52 mx-1 my-4">
              {renderRib(rib)}
            </div>
          ))}
        </div>
      </div>

      {draggingRib && renderRib(draggingRib, true, 0, dragPos)}
    </div>
  );
}
