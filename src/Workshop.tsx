import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Material, InkIngot, MoldType, Stage, MOLDS_DATA } from './types';

interface WorkshopProps {
  currentStage: Stage;
  materials: Material[];
  poundingCount: number;
  selectedMold: MoldType | null;
  inkIngots: InkIngot[];
  onOpenMaterialPanel: () => void;
  onPound: () => number;
  onPoundingComplete: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onSelectMold: (mold: MoldType) => void;
  onMoldingComplete: () => void;
  onSelectIngot: (ingot: InkIngot) => void;
  totalRatio: number;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

interface GoldParticle {
  id: number;
  x: number;
  y: number;
  angle: number;
  distance: number;
}

const Workshop: React.FC<WorkshopProps> = ({
  currentStage,
  materials,
  poundingCount,
  selectedMold,
  inkIngots,
  onOpenMaterialPanel,
  onPound,
  onPoundingComplete,
  onDragStart,
  onSelectMold,
  onMoldingComplete,
  onSelectIngot,
  totalRatio
}) => {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [goldParticles, setGoldParticles] = useState<GoldParticle[]>([]);
  const [isPressed, setIsPressed] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showMoldOpen, setShowMoldOpen] = useState(false);
  const [floatingNumbers, setFloatingNumbers] = useState<{ id: number; x: number; y: number }[]>([]);
  const poundingCompleteTriggered = useRef(false);

  const usedMaterials = useMemo(
    () => materials.filter(m => m.ratio > 0),
    [materials]
  );

  const handlePound = useCallback(() => {
    if (poundingCount >= 50 || currentStage !== 'pounding') return;
    
    const newParticleId = onPound();
    
    const newParticles: Particle[] = [];
    for (let i = 0; i < 5; i++) {
      newParticles.push({
        id: newParticleId * 10 + i,
        x: 50 + (Math.random() - 0.5) * 40,
        y: 50,
        vx: (Math.random() - 0.5) * 4,
        vy: -Math.random() * 6 - 2,
        life: 0.3
      });
    }
    setParticles(prev => [...prev, ...newParticles]);

    const floatId = Date.now();
    setFloatingNumbers(prev => [...prev, { id: floatId, x: 50, y: 30 }]);
    setTimeout(() => {
      setFloatingNumbers(prev => prev.filter(n => n.id !== floatId));
    }, 800);

    setIsPressed(true);
    setTimeout(() => setIsPressed(false), 100);
  }, [poundingCount, currentStage, onPound]);

  useEffect(() => {
    if (poundingCount >= 50 && !poundingCompleteTriggered.current) {
      poundingCompleteTriggered.current = true;
      setTimeout(() => {
        onPoundingComplete();
      }, 2000);
    }
  }, [poundingCount, onPoundingComplete]);

  useEffect(() => {
    if (particles.length === 0) return;
    
    const interval = setInterval(() => {
      setParticles(prev => 
        prev
          .map(p => ({
            ...p,
            x: p.x + p.vx,
            y: p.y + p.vy,
            vy: p.vy + 0.3,
            life: p.life - 0.05
          }))
          .filter(p => p.life > 0)
      );
    }, 30);

    return () => clearInterval(interval);
  }, [particles.length]);

  useEffect(() => {
    if (selectedMold && countdown === null) {
      setCountdown(10);
    }
  }, [selectedMold, countdown]);

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          setShowMoldOpen(true);
          
          const newGoldParticles: GoldParticle[] = [];
          for (let i = 0; i < 80; i++) {
            newGoldParticles.push({
              id: i,
              x: 50,
              y: 50,
              angle: (Math.PI * 2 * i) / 80,
              distance: 0
            });
          }
          setGoldParticles(newGoldParticles);
          
          setTimeout(() => {
            setShowMoldOpen(false);
            setGoldParticles([]);
            onMoldingComplete();
          }, 600);
          
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [countdown, onMoldingComplete]);

  useEffect(() => {
    if (goldParticles.length === 0) return;
    
    const interval = setInterval(() => {
      setGoldParticles(prev =>
        prev.map(p => ({
          ...p,
          distance: p.distance + 8
        })).filter(p => p.distance < 150)
      );
    }, 30);

    return () => clearInterval(interval);
  }, [goldParticles.length]);

  const getMoldShape = (type: MoldType): string => {
    const shapes: Record<MoldType, string> = {
      circle: '◯',
      rectangle: '▢',
      ruyi: '♡',
      dragon: '🐉'
    };
    return shapes[type];
  };

  const progress = (poundingCount / 50) * 100;
  const circumference = 2 * Math.PI * 80;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="workshop-container" style={{ width: '100%', display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
      <div
        className="workshop-room"
        style={{
          width: 1200,
          height: 800,
          position: 'relative',
          transformStyle: 'preserve-3d',
          perspective: 1000,
          flexShrink: 0
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 200,
            background: 'linear-gradient(180deg, #8b7355 0%, #a08060 100%)',
            transform: 'rotateX(60deg)',
            transformOrigin: 'top'
          }}
        />

        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 300,
            backgroundColor: '#6b5b47',
            backgroundImage: `
              linear-gradient(90deg, rgba(0,0,0,0.1) 1px, transparent 1px),
              linear-gradient(rgba(0,0,0,0.1) 1px, transparent 1px)
            `,
            backgroundSize: '80px 40px'
          }}
        />

        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 150,
            height: '100%',
            background: 'linear-gradient(90deg, #5c4a3a 0%, #6b5a4a 100%)',
            transform: 'rotateY(60deg)',
            transformOrigin: 'left',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-start',
            paddingTop: 80,
            gap: 30
          }}
        >
          <div style={{ fontSize: 60, transform: 'rotate(-15deg)' }}>🖌️</div>
          <div style={{ fontSize: 60, transform: 'rotate(10deg)' }}>🖋️</div>
        </div>

        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 150,
            height: '100%',
            background: 'linear-gradient(-90deg, #5c4a3a 0%, #6b5a4a 100%)',
            transform: 'rotateY(-60deg)',
            transformOrigin: 'right',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-start',
            paddingTop: 80,
            gap: 30
          }}
        >
          <div style={{ fontSize: 60, transform: 'rotate(15deg)' }}>📜</div>
          <div style={{ fontSize: 60, transform: 'rotate(-10deg)' }}>🎋</div>
        </div>

        <div style={{ position: 'absolute', bottom: 100, left: 180, width: 180, textAlign: 'center' }}>
          <Workstation
            title="选料台"
            isActive={currentStage === 'material'}
            onClick={onOpenMaterialPanel}
            disabled={currentStage !== 'material'}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', padding: 10 }}>
              {usedMaterials.length > 0 ? (
                usedMaterials.map(m => (
                  <div
                    key={m.id}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 4,
                      background: m.gradient,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      color: m.id === 'borneol' || m.id === 'glue' ? '#333' : 'white'
                    }}
                    title={`${m.name}×${m.ratio}`}
                  >
                    {m.ratio}
                  </div>
                ))
              ) : (
                <div style={{ color: '#999', fontSize: 14 }}>点击选料</div>
              )}
            </div>
            {totalRatio > 0 && (
              <div style={{ color: '#ffd700', fontSize: 14, marginTop: 8 }}>
                配比: {totalRatio}/30
              </div>
            )}
          </Workstation>
        </div>

        <div style={{ position: 'absolute', bottom: 100, left: 510, width: 180, textAlign: 'center' }}>
          <Workstation
            title="捣练台"
            isActive={currentStage === 'pounding'}
            disabled={currentStage !== 'pounding'}
          >
            <div style={{ position: 'relative', width: 200, height: 220, margin: '0 auto' }}>
              <div
                style={{
                  position: 'absolute',
                  top: 10,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 180,
                  height: 180
                }}
              >
                <svg width="180" height="180" style={{ transform: 'rotate(-90deg)' }}>
                  <circle
                    cx="90"
                    cy="90"
                    r="80"
                    fill="none"
                    stroke="#333"
                    strokeWidth="8"
                  />
                  <circle
                    cx="90"
                    cy="90"
                    r="80"
                    fill="none"
                    stroke="#1a1a1a"
                    strokeWidth="8"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                  />
                </svg>
                <div
                  style={{
                    position: 'absolute',
                    top: 15,
                    left: 15,
                    width: 150,
                    height: 150,
                    borderRadius: '50%',
                    background: `
                      radial-gradient(circle at 30% 30%, #8a9b9b 0%, #7a8b8b 40%, #6a7b7b 100%)
                    `,
                    boxShadow: `
                      inset 0 0 30px rgba(0,0,0,0.4),
                      0 4px 15px rgba(0,0,0,0.3)
                    `,
                    filter: 'url(#stone-texture)'
                  }}
                >
                  {poundingCount >= 50 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        borderRadius: '50%',
                        background: 'linear-gradient(45deg, transparent 30%, rgba(255,255,255,0.4) 50%, transparent 70%)',
                        animation: 'shimmer 2s linear infinite'
                      }}
                    />
                  )}
                  
                  {particles.map(p => (
                    <div
                      key={p.id}
                      className="particle"
                      style={{
                        left: `${p.x}%`,
                        top: `${p.y}%`,
                        width: 6,
                        height: 6,
                        backgroundColor: '#e0e0e0',
                        opacity: p.life / 0.3,
                        transform: 'translate(-50%, -50%)'
                      }}
                    />
                  ))}

                  {floatingNumbers.map(n => (
                    <div
                      key={n.id}
                      style={{
                        position: 'absolute',
                        left: `${n.x}%`,
                        top: `${n.y}%`,
                        transform: 'translate(-50%, -50%)',
                        color: '#ffd700',
                        fontSize: 20,
                        fontWeight: 'bold',
                        animation: 'count-float 0.8s ease-out forwards',
                        pointerEvents: 'none'
                      }}
                    >
                      +1
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ position: 'absolute', top: 80, left: '50%', transform: 'translateX(-50%)' }}>
                <div style={{ color: 'white', fontSize: 24, textAlign: 'center', marginBottom: 8 }}>
                  {poundingCount} / 50
                </div>
              </div>

              <motion.button
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: '50%',
                  transform: `translateX(-50%) scale(${isPressed ? 0.95 : 1})`,
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  backgroundColor: isPressed ? '#3e2a16' : '#5c3a21',
                  color: '#ffd700',
                  fontSize: 24,
                  fontWeight: 'bold',
                  boxShadow: `
                    0 4px 15px rgba(0,0,0,0.4),
                    inset 0 2px 4px rgba(255,255,255,0.1)
                  `,
                  cursor: currentStage === 'pounding' && poundingCount < 50 ? 'pointer' : 'not-allowed',
                  opacity: currentStage === 'pounding' && poundingCount < 50 ? 1 : 0.5,
                  transition: 'all 0.1s ease'
                }}
                onClick={handlePound}
                whileHover={currentStage === 'pounding' && poundingCount < 50 ? { scale: 1.05 } : {}}
                whileTap={currentStage === 'pounding' && poundingCount < 50 ? { scale: 0.95 } : {}}
                disabled={currentStage !== 'pounding' || poundingCount >= 50}
              >
                捣
              </motion.button>
            </div>
          </Workstation>
        </div>

        <div style={{ position: 'absolute', bottom: 100, left: 840, width: 180, textAlign: 'center' }}>
          <Workstation
            title="成型台"
            isActive={currentStage === 'molding'}
            disabled={currentStage !== 'molding'}
          >
            <div
              style={{
                padding: 10,
                cursor: currentStage === 'molding' && poundingCount >= 50 ? 'grab' : 'default'
              }}
              onMouseDown={onDragStart}
            >
              {currentStage === 'molding' && poundingCount >= 50 && !selectedMold && (
                <div style={{ color: '#ffd700', fontSize: 14, marginBottom: 10 }}>
                  ↓ 拖拽物料至模具 ↓
                </div>
              )}
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                {MOLDS_DATA.map(mold => (
                  <div
                    key={mold.id}
                    className="mold-card"
                    style={{
                      width: 110,
                      height: 110,
                      border: `2px solid ${selectedMold === mold.id ? '#ffd700' : '#5c3a21'}`,
                      borderRadius: 8,
                      backgroundColor: '#3a2010',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: currentStage === 'molding' && poundingCount >= 50 ? 'pointer' : 'not-allowed',
                      opacity: currentStage === 'molding' && poundingCount >= 50 ? 1 : 0.5,
                      transition: 'all 0.3s ease-out',
                      position: 'relative',
                      overflow: 'hidden'
                    }}
                    onClick={() => currentStage === 'molding' && poundingCount >= 50 && onSelectMold(mold.id)}
                    onMouseEnter={e => {
                      if (currentStage === 'molding' && poundingCount >= 50) {
                        e.currentTarget.style.transform = 'scale(1.05)';
                      }
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                  >
                    <AnimatePresence>
                      {selectedMold === mold.id && showMoldOpen && (
                        <motion.div
                          initial={{ scale: 1 }}
                          animate={{ scale: [1, 1.1, 1] }}
                          transition={{ duration: 0.6 }}
                          style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'linear-gradient(135deg, #1a1a1a 0%, #333 100%)'
                          }}
                        >
                          <span style={{ fontSize: 40, color: 'rgba(255,255,255,0.2)' }}>
                            {getMoldShape(mold.id)}
                          </span>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {selectedMold === mold.id && goldParticles.map(p => (
                      <div
                        key={p.id}
                        className="particle"
                        style={{
                          left: `calc(50% + ${Math.cos(p.angle) * p.distance}px)`,
                          top: `calc(50% + ${Math.sin(p.angle) * p.distance}px)`,
                          width: 4,
                          height: 4,
                          backgroundColor: '#ffd700',
                          transform: 'translate(-50%, -50%)',
                          opacity: 1 - p.distance / 150
                        }}
                      />
                    ))}

                    {!(selectedMold === mold.id && showMoldOpen) && (
                      <>
                        <span style={{ fontSize: 36, color: '#8b7355' }}>{getMoldShape(mold.id)}</span>
                        <span style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>{mold.name}</span>
                      </>
                    )}

                    {selectedMold === mold.id && countdown !== null && countdown > 0 && (
                      <motion.div
                        key={countdown}
                        initial={{ y: 20, opacity: 0, scale: 0.5 }}
                        animate={{ y: -30, opacity: 1, scale: 1.5 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1 }}
                        style={{
                          position: 'absolute',
                          top: '50%',
                          left: '50%',
                          transform: 'translate(-50%, -50%)',
                          color: 'white',
                          fontSize: 32,
                          fontWeight: 'bold',
                          fontFamily: 'KaiTi, STKaiti, serif',
                          textShadow: '0 2px 8px rgba(0,0,0,0.5)'
                        }}
                      >
                        {countdown}
                      </motion.div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </Workstation>
        </div>

        <div style={{ position: 'absolute', bottom: 80, left: 1010, width: 180, textAlign: 'center' }}>
          <div
            style={{
              backgroundColor: '#4a2c1a',
              borderRadius: '8px 8px 0 0',
              padding: '8px 0',
              color: 'white',
              fontSize: 18,
              marginBottom: 4
            }}
          >
            晾晒架
          </div>
          <div
            style={{
              background: 'linear-gradient(180deg, #c89960 0%, #d4a373 100%)',
              borderRadius: 8,
              padding: 12,
              minHeight: 340,
              boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[0, 1, 2].map(shelfIndex => (
                <div
                  key={shelfIndex}
                  style={{
                    height: 100,
                    backgroundColor: 'rgba(139, 115, 85, 0.3)',
                    borderRadius: 4,
                    padding: 8,
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexWrap: 'wrap',
                    borderBottom: shelfIndex < 2 ? '3px solid #8b7355' : 'none'
                  }}
                >
                  {inkIngots
                    .filter((_, i) => Math.floor(i / 3) === shelfIndex)
                    .map(ingot => (
                      <IngotThumbnail
                        key={ingot.id}
                        ingot={ingot}
                        onClick={() => ingot.isCompleted && onSelectIngot(ingot)}
                      />
                    ))}
                  {Array.from({ length: Math.max(0, 3 - inkIngots.filter((_, i) => Math.floor(i / 3) === shelfIndex).length) }).map((_, i) => (
                    <div
                      key={`empty-${i}`}
                      style={{
                        width: 60,
                        height: 60,
                        border: '2px dashed #8b7355',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#8b7355',
                        fontSize: 24
                      }}
                    >
                      空
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          <filter id="stone-texture">
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" result="noise" />
            <feDiffuseLighting in="noise" lightingColor="white" surfaceScale="2">
              <feDistantLight azimuth="45" elevation="60" />
            </feDiffuseLighting>
          </filter>
        </defs>
      </svg>
    </div>
  );
};

const Workstation: React.FC<{
  title: string;
  isActive: boolean;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ title, isActive, onClick, disabled, children }) => {
  return (
    <div>
      <div
        style={{
          backgroundColor: '#4a2c1a',
          borderRadius: '8px 8px 0 0',
          padding: '8px 0',
          color: isActive ? '#ffd700' : 'white',
          fontSize: 18,
          marginBottom: 4,
          boxShadow: isActive ? '0 0 15px rgba(255, 215, 0, 0.5)' : 'none',
          transition: 'all 0.3s ease'
        }}
      >
        {title}
      </div>
      <div
        onClick={disabled ? undefined : onClick}
        style={{
          backgroundColor: isActive ? 'rgba(74, 44, 26, 0.95)' : 'rgba(74, 44, 26, 0.7)',
          borderRadius: 8,
          padding: 16,
          minHeight: 260,
          boxShadow: isActive 
            ? '0 4px 20px rgba(255, 215, 0, 0.3), 0 4px 15px rgba(0,0,0,0.3)' 
            : '0 4px 15px rgba(0,0,0,0.3)',
          cursor: disabled ? 'not-allowed' : onClick ? 'pointer' : 'default',
          opacity: disabled ? 0.6 : 1,
          transition: 'all 0.3s ease-out'
        }}
      >
        {children}
      </div>
    </div>
  );
};

const IngotThumbnail: React.FC<{
  ingot: InkIngot;
  onClick: () => void;
}> = ({ ingot, onClick }) => {
  const getMoldShape = (type: MoldType): string => {
    const shapes: Record<MoldType, string> = {
      circle: '◯',
      rectangle: '▢',
      ruyi: '♡',
      dragon: '🐉'
    };
    return shapes[type];
  };

  const progressColor = ingot.isCompleted
    ? '#1a1a1a'
    : `rgb(${Math.floor(192 - ingot.dryingProgress * 1.92)}, ${Math.floor(192 - ingot.dryingProgress * 1.92)}, ${Math.floor(192 - ingot.dryingProgress * 1.92)})`;

  return (
    <div
      style={{
        width: 60,
        height: 80,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        cursor: ingot.isCompleted ? 'pointer' : 'default'
      }}
      onClick={onClick}
    >
      <div
        style={{
          width: 60,
          height: 60,
          borderRadius: 4,
          background: ingot.isCompleted
            ? 'linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%)'
            : 'linear-gradient(135deg, #888 0%, #aaa 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 28,
          color: 'rgba(255,255,255,0.2)',
          boxShadow: ingot.isCompleted
            ? '0 2px 8px rgba(0,0,0,0.4), inset 0 0 15px #444'
            : '0 2px 8px rgba(0,0,0,0.2)',
          transition: 'all 0.5s ease'
        }}
      >
        {getMoldShape(ingot.moldType)}
      </div>
      <div
        style={{
          width: '100%',
          height: 6,
          backgroundColor: '#d4c9b3',
          borderRadius: 3,
          marginTop: 4,
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${ingot.dryingProgress}%`,
            backgroundColor: progressColor,
            transition: 'width 0.3s ease, background-color 0.5s ease'
          }}
        />
      </div>
    </div>
  );
};

export default React.memo(Workshop);
