import React, { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';

interface TeaSetHandle {
  pointTea: () => void;
  whisk: () => void;
}

interface Splash {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export const TeaSet = forwardRef<TeaSetHandle>((_props, ref) => {
  const phase = useGameStore(state => state.phase);
  const setWaterAmount = useGameStore(state => state.setWaterAmount);
  const setWhiskData = useGameStore(state => state.setWhiskData);
  const calculateFoam = useGameStore(state => state.calculateFoam);
  const calculateUserScore = useGameStore(state => state.calculateUserScore);
  const setPhase = useGameStore(state => state.setPhase);

  const bottleRef = useRef<HTMLDivElement>(null);
  const bowlRef = useRef<HTMLDivElement>(null);
  const whiskRef = useRef<HTMLDivElement>(null);
  const [bottleAngle, setBottleAngle] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isWhisking, setIsWhisking] = useState(false);
  const [splashes, setSplashes] = useState<Splash[]>([]);
  const [waterAmount, setLocalWater] = useState(0);
  const [whiskPosition, setWhiskPosition] = useState({ x: 0, y: 0 });
  const [whiskRotation, setWhiskRotation] = useState(0);
  
  const lastMoveTime = useRef(0);
  const totalWhiskTime = useRef(0);
  const totalWhiskDistance = useRef(0);
  const lastPosition = useRef({ x: 0, y: 0 });
  const splashId = useRef(0);

  useImperativeHandle(ref, () => ({
    pointTea: () => {
      setPhase('pouring');
    },
    whisk: () => {
      setPhase('whisking');
    }
  }));

  const handleBottleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (phase !== 'pouring') return;
    setIsDragging(true);
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    lastPosition.current = { x: clientX, y: clientY };
  }, [phase]);

  const handleBottleDragMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging || phase !== 'pouring') return;
    e.preventDefault();
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const bowl = bowlRef.current;
    const bottle = bottleRef.current;
    if (!bowl || !bottle) return;
    
    const bowlRect = bowl.getBoundingClientRect();
    const bowlCenterX = bowlRect.left + bowlRect.width / 2;
    const bowlCenterY = bowlRect.top + bowlRect.height / 2;
    
    const dx = bowlCenterX - clientX;
    const dy = clientY - bowlCenterY;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
    const clampedAngle = Math.max(0, Math.min(60, angle));
    
    setBottleAngle(clampedAngle);
    
    const flowRate = clampedAngle / 60 * 2;
    const newWater = Math.min(100, waterAmount + flowRate);
    setLocalWater(newWater);
    setWaterAmount(newWater);
    
    if (clampedAngle > 15 && Math.random() > 0.7) {
      const splash: Splash = {
        id: splashId.current++,
        x: 50 + (Math.random() - 0.5) * 30,
        y: 50 + (Math.random() - 0.5) * 30,
        dx: (Math.random() - 0.5) * 20,
        dy: -Math.random() * 15 - 5,
      };
      setSplashes(prev => [...prev, splash]);
      setTimeout(() => {
        setSplashes(prev => prev.filter(s => s.id !== splash.id));
      }, 300);
    }
    
    lastPosition.current = { x: clientX, y: clientY };
  }, [isDragging, phase, waterAmount, setWaterAmount]);

  const handleBottleDragEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    setBottleAngle(0);
    if (waterAmount > 10) {
      setPhase('whisking');
    }
  }, [isDragging, waterAmount, setPhase]);

  const handleWhiskStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (phase !== 'whisking') return;
    e.preventDefault();
    setIsWhisking(true);
    totalWhiskTime.current = 0;
    totalWhiskDistance.current = 0;
    lastMoveTime.current = Date.now();
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const bowl = bowlRef.current;
    if (!bowl) return;
    const bowlRect = bowl.getBoundingClientRect();
    lastPosition.current = { 
      x: clientX - bowlRect.left, 
      y: clientY - bowlRect.top 
    };
    setWhiskPosition(lastPosition.current);
  }, [phase]);

  const handleWhiskMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isWhisking || phase !== 'whisking') return;
    e.preventDefault();
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const bowl = bowlRef.current;
    if (!bowl) return;
    const bowlRect = bowl.getBoundingClientRect();
    
    const newX = Math.max(30, Math.min(bowlRect.width - 30, clientX - bowlRect.left));
    const newY = Math.max(30, Math.min(bowlRect.height - 30, clientY - bowlRect.top));
    
    const dx = newX - lastPosition.current.x;
    const dy = newY - lastPosition.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    totalWhiskDistance.current += distance;
    
    const now = Date.now();
    const deltaTime = now - lastMoveTime.current;
    totalWhiskTime.current += deltaTime;
    lastMoveTime.current = now;
    
    const avgSpeed = totalWhiskTime.current > 0 
      ? (totalWhiskDistance.current / totalWhiskTime.current) * 1000 
      : 0;
    
    setWhiskPosition({ x: newX, y: newY });
    setWhiskRotation(prev => prev + distance * 2);
    setWhiskData(Math.min(20, avgSpeed / 50), totalWhiskTime.current);
    calculateFoam();
    
    lastPosition.current = { x: newX, y: newY };
  }, [isWhisking, phase, setWhiskData, calculateFoam]);

  const handleWhiskEnd = useCallback(() => {
    if (!isWhisking) return;
    setIsWhisking(false);
    
    if (totalWhiskTime.current > 500) {
      setPhase('user_done');
      setTimeout(() => {
        calculateUserScore();
      }, 500);
    }
  }, [isWhisking, setPhase, calculateUserScore]);

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isWhisking) {
        const bowl = bowlRef.current;
        if (!bowl) return;
        const bowlRect = bowl.getBoundingClientRect();
        const newX = Math.max(30, Math.min(bowlRect.width - 30, e.clientX - bowlRect.left));
        const newY = Math.max(30, Math.min(bowlRect.height - 30, e.clientY - bowlRect.top));
        
        const dx = newX - lastPosition.current.x;
        const dy = newY - lastPosition.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        totalWhiskDistance.current += distance;
        
        const now = Date.now();
        const deltaTime = now - lastMoveTime.current;
        totalWhiskTime.current += deltaTime;
        lastMoveTime.current = now;
        
        const avgSpeed = totalWhiskTime.current > 0 
          ? (totalWhiskDistance.current / totalWhiskTime.current) * 1000 
          : 0;
        
        setWhiskPosition({ x: newX, y: newY });
        setWhiskRotation(prev => prev + distance * 2);
        setWhiskData(Math.min(20, avgSpeed / 50), totalWhiskTime.current);
        calculateFoam();
        
        lastPosition.current = { x: newX, y: newY };
      }
      if (isDragging) {
        const bowl = bowlRef.current;
        const bottle = bottleRef.current;
        if (!bowl || !bottle) return;
        
        const bowlRect = bowl.getBoundingClientRect();
        const bowlCenterX = bowlRect.left + bowlRect.width / 2;
        const bowlCenterY = bowlRect.top + bowlRect.height / 2;
        
        const dx = bowlCenterX - e.clientX;
        const dy = e.clientY - bowlCenterY;
        const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
        const clampedAngle = Math.max(0, Math.min(60, angle));
        
        setBottleAngle(clampedAngle);
        
        const flowRate = clampedAngle / 60 * 2;
        const newWater = Math.min(100, waterAmount + flowRate);
        setLocalWater(newWater);
        setWaterAmount(newWater);
        
        if (clampedAngle > 15 && Math.random() > 0.7) {
          const splash: Splash = {
            id: splashId.current++,
            x: 50 + (Math.random() - 0.5) * 30,
            y: 50 + (Math.random() - 0.5) * 30,
            dx: (Math.random() - 0.5) * 20,
            dy: -Math.random() * 15 - 5,
          };
          setSplashes(prev => [...prev, splash]);
          setTimeout(() => {
            setSplashes(prev => prev.filter(s => s.id !== splash.id));
          }, 300);
        }
      }
    };
    
    const handleGlobalMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        setBottleAngle(0);
        if (waterAmount > 10) {
          setPhase('whisking');
        }
      }
      if (isWhisking) {
        setIsWhisking(false);
        if (totalWhiskTime.current > 500) {
          setPhase('user_done');
          setTimeout(() => {
            calculateUserScore();
          }, 500);
        }
      }
    };
    
    if (isDragging || isWhisking) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
    }
    
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, isWhisking, waterAmount, setWaterAmount, setPhase, setWhiskData, calculateFoam, calculateUserScore]);

  const WhiskBristles = () => {
    const bristles = [];
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const offsetX = Math.cos(angle) * 8;
      const offsetY = Math.sin(angle) * 8;
      bristles.push(
        <div
          key={i}
          className="absolute rounded-b-full"
          style={{
            width: '3px',
            height: '40px',
            background: 'linear-gradient(180deg, #c49a3c 0%, #d4a76a 50%, #e4b77a 100%)',
            left: `calc(50% + ${offsetX}px - 1.5px)`,
            top: '60%',
            transformOrigin: 'top center',
            transform: `rotate(${angle * 30}deg)`,
            borderRadius: '0 0 2px 2px',
          }}
        />
      );
    }
    return <>{bristles}</>;
  };

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <div
        ref={bowlRef}
        className="relative"
        style={{
          width: '280px',
          height: '120px',
        }}
        onMouseDown={handleWhiskStart}
        onMouseMove={handleWhiskMove}
        onMouseUp={handleWhiskEnd}
        onMouseLeave={handleWhiskEnd}
        onTouchStart={handleWhiskStart}
        onTouchMove={handleWhiskMove}
        onTouchEnd={handleWhiskEnd}
      >
        <div
          className="absolute inset-0 rounded-full jianzhan"
          style={{
            boxShadow: 'inset 0 15px 40px rgba(0,0,0,0.6), 0 8px 25px rgba(0,0,0,0.5)',
            borderRadius: '50% 50% 45% 45%',
          }}
        />
        
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: `repeating-radial-gradient(circle at 50% 40%, transparent 0px, transparent 3px, rgba(196, 154, 60, ${0.15 + waterAmount * 0.004}) 4px, transparent 6px)`,
            borderRadius: '50% 50% 45% 45%',
          }}
        />
        
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            left: '10%',
            right: '10%',
            top: '20%',
            bottom: '15%',
            background: `linear-gradient(180deg, 
              rgba(58, 32, 16, ${0.3 + waterAmount * 0.005}) 0%, 
              rgba(58, 32, 16, ${0.5 + waterAmount * 0.004}) 100%)`,
            borderRadius: '50%',
          }}
        />
        
        {splashes.map(splash => (
          <div
            key={splash.id}
            className="splash-particle"
            style={{
              left: `${splash.x}%`,
              top: `${splash.y}%`,
              width: '8px',
              height: '8px',
              '--dx': `${splash.dx}px`,
              '--dy': `${splash.dy}px`,
            } as React.CSSProperties}
          />
        ))}
        
        {bottleAngle > 10 && (
          <div
            className="absolute water-stream pointer-events-none"
            style={{
              left: '50%',
              top: '-80px',
              width: `${4 + bottleAngle * 0.1}px`,
              height: '100px',
              transform: `translateX(-50%) rotate(${bottleAngle * 0.3}deg)`,
              transformOrigin: 'top center',
              borderRadius: '2px',
              opacity: bottleAngle / 60,
            }}
          />
        )}
        
        {isWhisking && (
          <div
            ref={whiskRef}
            className="absolute pointer-events-none z-20"
            style={{
              left: whiskPosition.x - 25,
              top: whiskPosition.y - 60,
              width: '50px',
              height: '100px',
              transform: `rotate(${whiskRotation * 0.1}deg)`,
              transition: 'left 0.05s linear, top 0.05s linear',
            }}
          >
            <div
              className="absolute bamboo-whisk rounded-full"
              style={{
                width: '8px',
                height: '50px',
                left: 'calc(50% - 4px)',
                top: 0,
                borderRadius: '4px',
              }}
            />
            <div
              className="absolute bamboo-whisk"
              style={{
                width: '30px',
                height: '12px',
                left: 'calc(50% - 15px)',
                top: '45px',
                borderRadius: '6px',
              }}
            />
            <div className="relative w-full h-full">
              <WhiskBristles />
            </div>
          </div>
        )}
      </div>
      
      <motion.div
        ref={bottleRef}
        className={`absolute interactive-btn ${phase === 'pouring' ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed opacity-60'}`}
        style={{
          width: '80px',
          height: '140px',
          right: '10%',
          top: '20%',
          transformOrigin: 'bottom center',
          rotate: `${bottleAngle}deg`,
          transition: isDragging ? 'none' : 'rotate 0.3s ease',
        }}
        onMouseDown={handleBottleDragStart}
        onMouseMove={handleBottleDragMove}
        onMouseUp={handleBottleDragEnd}
        onMouseLeave={handleBottleDragEnd}
        onTouchStart={handleBottleDragStart}
        onTouchMove={handleBottleDragMove}
        onTouchEnd={handleBottleDragEnd}
        whileHover={phase === 'pouring' ? { scale: 1.05 } : {}}
        whileTap={phase === 'pouring' ? { scale: 0.95 } : {}}
      >
        <div
          className="absolute celadon crackle-glaze rounded-full"
          style={{
            width: '60px',
            height: '80px',
            left: '10px',
            bottom: '20px',
            borderRadius: '40% 40% 50% 50%',
            boxShadow: 'inset -8px -8px 20px rgba(0,0,0,0.2), inset 8px 8px 20px rgba(255,255,255,0.1), 4px 4px 15px rgba(0,0,0,0.3)',
          }}
        />
        <div
          className="absolute celadon"
          style={{
            width: '35px',
            height: '30px',
            left: '22px',
            top: '15px',
            borderRadius: '50% 50% 30% 30%',
            boxShadow: 'inset -3px -3px 10px rgba(0,0,0,0.2)',
          }}
        />
        <div
          className="absolute celadon"
          style={{
            width: '8px',
            height: '35px',
            right: '-2px',
            top: '35px',
            borderRadius: '4px',
            transform: 'rotate(-30deg)',
            transformOrigin: 'bottom center',
            boxShadow: 'inset -2px -2px 6px rgba(0,0,0,0.2)',
          }}
        />
        <div
          className="absolute celadon rounded-full"
          style={{
            width: '12px',
            height: '12px',
            right: '-6px',
            top: '28px',
            boxShadow: 'inset -2px -2px 4px rgba(0,0,0,0.2)',
          }}
        />
        <div
          className="absolute celadon"
          style={{
            width: '20px',
            height: '35px',
            left: '0px',
            top: '45px',
            borderRadius: '10px 0 0 10px',
            boxShadow: 'inset 3px -3px 8px rgba(0,0,0,0.2)',
          }}
        />
      </motion.div>
      
      {phase === 'whisking' && !isWhisking && (
        <div
          className="absolute interactive-btn z-10"
          style={{
            left: '15%',
            top: '15%',
            width: '60px',
            height: '120px',
            cursor: 'grab',
          }}
          onMouseDown={handleWhiskStart}
          onTouchStart={handleWhiskStart}
        >
          <motion.div
            className="relative w-full h-full"
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <div
              className="absolute bamboo-whisk rounded-full"
              style={{
                width: '10px',
                height: '60px',
                left: 'calc(50% - 5px)',
                top: 0,
                borderRadius: '5px',
              }}
            />
            <div
              className="absolute bamboo-whisk"
              style={{
                width: '36px',
                height: '14px',
                left: 'calc(50% - 18px)',
                top: '55px',
                borderRadius: '7px',
              }}
            />
            <div className="relative w-full h-full">
              <WhiskBristles />
            </div>
          </motion.div>
          <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs font-kai text-amber-900 whitespace-nowrap">
            点击击拂
          </div>
        </div>
      )}
    </div>
  );
});

TeaSet.displayName = 'TeaSet';
