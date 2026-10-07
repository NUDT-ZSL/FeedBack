import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import confetti from 'canvas-confetti';
import Workshop from './Workshop';
import InkForm from './InkForm';
import { Material, InkIngot, Store, MATERIALS_DATA, MoldType } from './types';

const App: React.FC = () => {
  const [store, setStore] = useState<Store>({
    materials: MATERIALS_DATA.map(m => ({ ...m, ratio: 0 })),
    poundingCount: 0,
    selectedMold: null,
    currentStage: 'material',
    inkIngots: []
  });

  const [showMaterialPanel, setShowMaterialPanel] = useState(false);
  const [selectedIngot, setSelectedIngot] = useState<InkIngot | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const particleIdRef = useRef(0);

  const completedCount = useMemo(
    () => store.inkIngots.filter(ingot => ingot.isCompleted).length,
    [store.inkIngots]
  );

  const totalRatio = useMemo(
    () => store.materials.reduce((sum, m) => sum + m.ratio, 0),
    [store.materials]
  );

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const triggerConfetti = useCallback(() => {
    confetti({
      particleCount: 50,
      spread: 70,
      origin: { x: 0.9, y: 0.5 },
      colors: ['#ffd700', '#8b0000'],
      ticks: 72,
      gravity: 1,
      scalar: 1
    });
  }, []);

  const updateMaterialRatio = useCallback((materialId: string, ratio: number) => {
    setStore(prev => ({
      ...prev,
      materials: prev.materials.map(m =>
        m.id === materialId ? { ...m, ratio } : m
      )
    }));
  }, []);

  const confirmMaterials = useCallback(() => {
    if (totalRatio > 30 || totalRatio === 0) return;
    setShowMaterialPanel(false);
    setStore(prev => ({ ...prev, currentStage: 'pounding' }));
  }, [totalRatio]);

  const addPounding = useCallback(() => {
    setStore(prev => ({
      ...prev,
      poundingCount: Math.min(prev.poundingCount + 1, 50)
    }));
    return particleIdRef.current++;
  }, []);

  const handlePoundingComplete = useCallback(() => {
    setStore(prev => ({ ...prev, currentStage: 'molding' }));
  }, []);

  const selectMold = useCallback((moldType: MoldType) => {
    setStore(prev => ({ ...prev, selectedMold: moldType }));
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (store.currentStage !== 'molding' || store.poundingCount < 50) return;
    setIsDragging(true);
    setDragPosition({ x: e.clientX, y: e.clientY });
  }, [store.currentStage, store.poundingCount]);

  const handleDragMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setDragPosition({ x: e.clientX, y: e.clientY });
  }, [isDragging]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMoldingComplete = useCallback(() => {
    if (!store.selectedMold) return;
    
    const newIngot: InkIngot = {
      id: uuidv4(),
      materials: [...store.materials],
      poundingCount: store.poundingCount,
      moldType: store.selectedMold,
      dryingProgress: 0,
      isCompleted: false,
      createdAt: Date.now(),
      dryingStartTime: Date.now()
    };

    setStore(prev => ({
      ...prev,
      inkIngots: [...prev.inkIngots, newIngot],
      currentStage: 'drying',
      materials: MATERIALS_DATA.map(m => ({ ...m, ratio: 0 })),
      poundingCount: 0,
      selectedMold: null
    }));

    setTimeout(() => {
      setStore(prev => ({ ...prev, currentStage: 'material' }));
    }, 1000);
  }, [store.selectedMold, store.materials, store.poundingCount]);

  useEffect(() => {
    const interval = setInterval(() => {
      setStore(prev => {
        const updatedIngots = prev.inkIngots.map(ingot => {
          if (ingot.isCompleted) return ingot;
          const newProgress = Math.min(ingot.dryingProgress + 2, 100);
          const isCompleted = newProgress >= 100;
          if (isCompleted && !ingot.isCompleted) {
            setTimeout(() => {
              showToast(`【${getMoldName(ingot.moldType)}】晾晒完成！`);
              triggerConfetti();
            }, 0);
          }
          return { ...ingot, dryingProgress: newProgress, isCompleted };
        });
        return { ...prev, inkIngots: updatedIngots };
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [showToast, triggerConfetti]);

  const getMoldName = (type: MoldType): string => {
    const names: Record<MoldType, string> = {
      circle: '圆形墨锭',
      rectangle: '长方形墨锭',
      ruyi: '如意形墨锭',
      dragon: '龙纹形墨锭'
    };
    return names[type];
  };

  const resetToMaterialStage = useCallback(() => {
    setStore(prev => ({ ...prev, currentStage: 'material' }));
  }, []);

  return (
    <div
      style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}
      onMouseMove={handleDragMove}
      onMouseUp={handleDragEnd}
      onMouseLeave={handleDragEnd}
    >
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 60,
          backgroundColor: '#4a2c1a',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          zIndex: 100,
          boxShadow: '0 2px 10px rgba(0,0,0,0.3)'
        }}
      >
        <h1 style={{ fontSize: 28, letterSpacing: 4 }}>古法墨坊</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 18 }}>已完成：{completedCount} / 8</span>
        </div>
      </header>

      <div
        style={{
          position: 'fixed',
          top: 60,
          left: 0,
          right: 0,
          height: 4,
          backgroundColor: '#d4c9b3',
          zIndex: 99
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${(completedCount / 8) * 100}%`,
            background: 'linear-gradient(90deg, #1a1a1a 0%, #333 100%)',
            transition: 'width 0.8s ease-out'
          }}
        />
      </div>

      <main style={{ marginTop: 64, padding: 20, flex: 1 }}>
        <InkForm
          materials={store.materials}
          currentStage={store.currentStage}
          poundingCount={store.poundingCount}
          selectedMold={store.selectedMold}
          onReset={resetToMaterialStage}
        />

        <div style={{ borderTop: '1px solid #d4c9b3', margin: '20px 0' }} />

        <Workshop
          currentStage={store.currentStage}
          materials={store.materials}
          poundingCount={store.poundingCount}
          selectedMold={store.selectedMold}
          inkIngots={store.inkIngots}
          onOpenMaterialPanel={() => setShowMaterialPanel(true)}
          onPound={addPounding}
          onPoundingComplete={handlePoundingComplete}
          onDragStart={handleDragStart}
          onSelectMold={selectMold}
          onMoldingComplete={handleMoldingComplete}
          onSelectIngot={setSelectedIngot}
          totalRatio={totalRatio}
        />
      </main>

      {showMaterialPanel && (
        <MaterialPanel
          materials={store.materials}
          totalRatio={totalRatio}
          onUpdateRatio={updateMaterialRatio}
          onConfirm={confirmMaterials}
          onClose={() => setShowMaterialPanel(false)}
        />
      )}

      {selectedIngot && (
        <IngotDetail
          ingot={selectedIngot}
          onClose={() => setSelectedIngot(null)}
          showToast={showToast}
        />
      )}

      {isDragging && (
        <div
          style={{
            position: 'fixed',
            left: dragPosition.x - 30,
            top: dragPosition.y - 30,
            width: 60,
            height: 60,
            borderRadius: '50%',
            backgroundColor: 'rgba(192, 192, 192, 0.7)',
            pointerEvents: 'none',
            zIndex: 1000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};

const MaterialPanel: React.FC<{
  materials: Material[];
  totalRatio: number;
  onUpdateRatio: (id: string, ratio: number) => void;
  onConfirm: () => void;
  onClose: () => void;
}> = ({ materials, totalRatio, onUpdateRatio, onConfirm, onClose }) => {
  const isOverLimit = totalRatio > 30;
  const isEmpty = totalRatio === 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'rgba(44, 44, 44, 0.95)',
          borderRadius: 12,
          padding: 32,
          maxWidth: 600,
          width: '90%',
          animation: isOverLimit ? 'pulse-red 0.5s ease-in-out 3' : 'none'
        }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ color: 'white', fontSize: 28, marginBottom: 24, textAlign: 'center' }}>
          选料配方
        </h2>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 24 }}>
          {materials.map(material => (
            <div key={material.id} style={{ textAlign: 'center' }}>
              <div
                className="material-card"
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 8,
                  background: material.gradient,
                  margin: '0 auto 8px',
                  cursor: 'pointer',
                  transition: 'transform 0.3s ease-out',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  color: material.id === 'borneol' || material.id === 'glue' ? '#333' : 'white',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'scale(1.05)';
                  e.currentTarget.title = `${material.name}: ${material.description}`;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'scale(1)';
                }}
                title={`${material.name}: ${material.description}`}
              >
                {material.name[0]}
              </div>
              <div style={{ color: 'white', fontSize: 14, marginBottom: 8 }}>{material.name}</div>
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                value={material.ratio}
                onChange={e => onUpdateRatio(material.id, parseInt(e.target.value))}
                style={{ width: '100%', cursor: 'pointer' }}
              />
              <div style={{ color: '#ffd700', fontSize: 12, marginTop: 4 }}>
                用量: {material.ratio}
              </div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ color: totalRatio > 30 ? '#ff4444' : 'white', fontSize: 18 }}>
            总配比: {totalRatio} / 30
            {isOverLimit && <span style={{ color: '#ff4444', marginLeft: 8 }}>⚠️ 超出限制！</span>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
          <button
            style={{
              padding: '12px 32px',
              backgroundColor: '#666',
              color: 'white',
              borderRadius: 8,
              fontSize: 18
            }}
            onClick={onClose}
          >
            取消
          </button>
          <button
            style={{
              padding: '12px 32px',
              backgroundColor: isOverLimit || isEmpty ? '#666' : '#ffd700',
              color: isOverLimit || isEmpty ? '#999' : '#1a1a1a',
              borderRadius: 8,
              fontSize: 18,
              cursor: isOverLimit || isEmpty ? 'not-allowed' : 'pointer'
            }}
            onClick={onConfirm}
            disabled={isOverLimit || isEmpty}
          >
            确认配方
          </button>
        </div>
      </div>
    </div>
  );
};

const IngotDetail: React.FC<{
  ingot: InkIngot;
  onClose: () => void;
  showToast: (msg: string) => void;
}> = ({ ingot, onClose, showToast }) => {
  const detailRef = useRef<HTMLDivElement>(null);

  const handleSave = async () => {
    if (!detailRef.current) return;
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(detailRef.current, {
        backgroundColor: '#f5f0e8',
        scale: 2
      });
      const link = document.createElement('a');
      link.download = `墨锭_${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      showToast('图鉴已保存！');
    } catch (error) {
      showToast('保存失败，请重试');
    }
  };

  const handleShare = async () => {
    const text = `【古法墨坊】${getMoldName(ingot.moldType)}\n` +
      `配方：${ingot.materials.filter(m => m.ratio > 0).map(m => `${m.name}×${m.ratio}`).join('，')}\n` +
      `捣练：${ingot.poundingCount}次\n` +
      `晾晒：${ingot.dryingProgress}%`;
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制到剪贴板');
    } catch {
      showToast('复制失败，请手动复制');
    }
  };

  const getMoldName = (type: MoldType): string => {
    const names: Record<MoldType, string> = {
      circle: '圆形墨锭',
      rectangle: '长方形墨锭',
      ruyi: '如意形墨锭',
      dragon: '龙纹形墨锭'
    };
    return names[type];
  };

  const getMoldShape = (type: MoldType): string => {
    const shapes: Record<MoldType, string> = {
      circle: '◯',
      rectangle: '▢',
      ruyi: '♡',
      dragon: '🐉'
    };
    return shapes[type];
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200
      }}
      onClick={onClose}
    >
      <div
        ref={detailRef}
        style={{
          width: 400,
          backgroundColor: '#f5f0e8',
          borderRadius: 12,
          padding: 32,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
        }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ fontSize: 28, textAlign: 'center', marginBottom: 24, color: '#1a1a1a' }}>
          {getMoldName(ingot.moldType)}
        </h2>

        <div
          style={{
            width: 200,
            height: 200,
            margin: '0 auto 24px',
            border: '4px solid #ffd700',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 80,
            background: 'linear-gradient(135deg, #1a1a1a 0%, #333 100%)',
            color: 'rgba(255,255,255,0.1)',
            boxShadow: 'inset 0 0 30px #444'
          }}
        >
          {getMoldShape(ingot.moldType)}
        </div>

        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 20, marginBottom: 12, color: '#4a2c1a' }}>配方信息</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {ingot.materials.filter(m => m.ratio > 0).map(m => (
              <li key={m.id} style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderBottom: '1px solid #d4c9b3',
                fontSize: 16
              }}>
                <span>{m.name}</span>
                <span style={{ color: '#5c3a21' }}>×{m.ratio}</span>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 16 }}>
          <div style={{ flex: 1, padding: 12, backgroundColor: '#d4c9b3', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ color: '#666', fontSize: 14 }}>捣练次数</div>
            <div style={{ fontSize: 24, color: '#1a1a1a' }}>{ingot.poundingCount}</div>
          </div>
          <div style={{ flex: 1, padding: 12, backgroundColor: '#d4c9b3', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ color: '#666', fontSize: 14 }}>晾晒进度</div>
            <div style={{ fontSize: 24, color: '#1a1a1a' }}>{ingot.dryingProgress}%</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, marginTop: 24 }}>
          <button
            style={{
              flex: 1,
              padding: 12,
              backgroundColor: '#4a2c1a',
              color: 'white',
              borderRadius: 8,
              fontSize: 18
            }}
            onClick={handleSave}
          >
            保存图鉴
          </button>
          <button
            style={{
              flex: 1,
              padding: 12,
              backgroundColor: '#ffd700',
              color: '#1a1a1a',
              borderRadius: 8,
              fontSize: 18
            }}
            onClick={handleShare}
          >
            分享
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
