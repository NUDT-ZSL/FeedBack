import React, { useMemo, useRef } from 'react';
import { Material, Stage, MoldType } from './types';

interface InkFormProps {
  materials: Material[];
  currentStage: Stage;
  poundingCount: number;
  selectedMold: MoldType | null;
  onReset: () => void;
}

const InkForm: React.FC<InkFormProps> = ({
  materials,
  currentStage,
  poundingCount,
  selectedMold,
  onReset
}) => {
  const formRef = useRef<HTMLDivElement>(null);

  const usedMaterials = useMemo(
    () => materials.filter(m => m.ratio > 0),
    [materials]
  );

  const totalRatio = useMemo(
    () => materials.reduce((sum, m) => sum + m.ratio, 0),
    [materials]
  );

  const stageNames: Record<Stage, string> = {
    material: '选料',
    pounding: '捣练',
    molding: '成型',
    drying: '晾晒'
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

  const handleSave = async () => {
    if (!formRef.current || usedMaterials.length === 0) return;
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(formRef.current, {
        backgroundColor: '#f5f0e8',
        scale: 2
      });
      const link = document.createElement('a');
      link.download = `墨锭_配方_${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (error) {
      console.error('保存失败:', error);
    }
  };

  return (
    <div
      ref={formRef}
      style={{
        maxWidth: 800,
        margin: '0 auto',
        backgroundColor: 'rgba(255,255,255,0.5)',
        borderRadius: 12,
        padding: 24,
        boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ fontSize: 28, color: '#4a2c1a' }}>制墨配方</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            style={{
              padding: '8px 20px',
              backgroundColor: '#5c3a21',
              color: 'white',
              borderRadius: 6,
              fontSize: 14
            }}
            onClick={onReset}
          >
            重新开始
          </button>
          <button
            style={{
              padding: '8px 20px',
              backgroundColor: '#ffd700',
              color: '#1a1a1a',
              borderRadius: 6,
              fontSize: 14,
              opacity: usedMaterials.length > 0 ? 1 : 0.5,
              cursor: usedMaterials.length > 0 ? 'pointer' : 'not-allowed'
            }}
            onClick={handleSave}
            disabled={usedMaterials.length === 0}
          >
            保存图鉴
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {(['material', 'pounding', 'molding', 'drying'] as Stage[]).map((stage, index) => {
          const stageOrder = ['material', 'pounding', 'molding', 'drying'];
          const currentIndex = stageOrder.indexOf(currentStage);
          const stageIndex = stageOrder.indexOf(stage);
          const isCompleted = stageIndex < currentIndex;
          const isActive = stageIndex === currentIndex;

          return (
            <div key={stage} style={{ flex: 1, minWidth: 120 }}>
              <div
                style={{
                  padding: '12px 16px',
                  backgroundColor: isActive ? '#4a2c1a' : isCompleted ? '#ffd700' : '#d4c9b3',
                  color: isActive ? '#ffd700' : isCompleted ? '#1a1a1a' : '#666',
                  borderRadius: 8,
                  textAlign: 'center',
                  fontSize: 16,
                  fontWeight: 'bold',
                  transition: 'all 0.3s ease'
                }}
              >
                {index + 1}. {stageNames[stage]}
              </div>
              {index < 3 && (
                <div
                  style={{
                    height: 4,
                    backgroundColor: isCompleted ? '#ffd700' : '#d4c9b3',
                    marginTop: -4,
                    transition: 'background-color 0.3s ease'
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <div
          style={{
            padding: 16,
            backgroundColor: 'rgba(212, 201, 179, 0.5)',
            borderRadius: 8
          }}
        >
          <h3 style={{ fontSize: 20, color: '#4a2c1a', marginBottom: 12 }}>配方材料</h3>
          {usedMaterials.length > 0 ? (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {usedMaterials.map(m => (
                <li
                  key={m.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 0',
                    borderBottom: '1px solid #d4c9b3',
                    fontSize: 16
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      background: m.gradient
                    }}
                  />
                  <span style={{ flex: 1 }}>{m.name}</span>
                  <span style={{ color: '#5c3a21', fontWeight: 'bold' }}>×{m.ratio}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: '#999', fontSize: 14 }}>尚未选择材料</p>
          )}
          {totalRatio > 0 && (
            <div style={{ marginTop: 12, fontSize: 14, color: '#666' }}>
              总配比: <span style={{ color: totalRatio > 30 ? '#ff4444' : '#1a1a1a', fontWeight: 'bold' }}>
                {totalRatio}
              </span> / 30
            </div>
          )}
        </div>

        <div
          style={{
            padding: 16,
            backgroundColor: 'rgba(212, 201, 179, 0.5)',
            borderRadius: 8
          }}
        >
          <h3 style={{ fontSize: 20, color: '#4a2c1a', marginBottom: 12 }}>制作进度</h3>
          
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 14, color: '#666' }}>捣练进度</span>
              <span style={{ fontSize: 14, fontWeight: 'bold' }}>{poundingCount} / 50</span>
            </div>
            <div
              style={{
                height: 8,
                backgroundColor: '#d4c9b3',
                borderRadius: 4,
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${(poundingCount / 50) * 100}%`,
                  background: 'linear-gradient(90deg, #1a1a1a 0%, #333 100%)',
                  transition: 'width 0.5s ease'
                }}
              />
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 14, color: '#666' }}>成型模具</span>
              <span style={{ fontSize: 14, fontWeight: 'bold' }}>
                {selectedMold ? getMoldName(selectedMold) : '未选择'}
              </span>
            </div>
            <div
              style={{
                height: 8,
                backgroundColor: '#d4c9b3',
                borderRadius: 4,
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: selectedMold ? '100%' : '0%',
                  background: 'linear-gradient(90deg, #ffd700 0%, #ffed4e 100%)',
                  transition: 'width 0.5s ease'
                }}
              />
            </div>
          </div>
        </div>

        <div
          style={{
            padding: 16,
            backgroundColor: 'rgba(212, 201, 179, 0.5)',
            borderRadius: 8
          }}
        >
          <h3 style={{ fontSize: 20, color: '#4a2c1a', marginBottom: 12 }}>当前状态</h3>
          <div style={{ fontSize: 16, lineHeight: 1.8 }}>
            <p>
              当前阶段：
              <span style={{ color: '#5c3a21', fontWeight: 'bold' }}>
                {stageNames[currentStage]}
              </span>
            </p>
            <p>
              配方材料：
              <span style={{ color: '#5c3a21', fontWeight: 'bold' }}>
                {usedMaterials.length} 种
              </span>
            </p>
            <p>
              捣练次数：
              <span style={{ color: poundingCount >= 50 ? '#228b22' : '#5c3a21', fontWeight: 'bold' }}>
                {poundingCount} 次
                {poundingCount >= 50 && ' ✓'}
              </span>
            </p>
            <p>
              模具选择：
              <span style={{ color: selectedMold ? '#228b22' : '#5c3a21', fontWeight: 'bold' }}>
                {selectedMold ? '已选择 ✓' : '未选择'}
              </span>
            </p>
          </div>

          {currentStage === 'material' && usedMaterials.length === 0 && (
            <div style={{ marginTop: 12, padding: 12, backgroundColor: '#fff3cd', borderRadius: 6, fontSize: 14, color: '#856404' }}>
              💡 点击下方选料台开始选择材料
            </div>
          )}
          {currentStage === 'pounding' && (
            <div style={{ marginTop: 12, padding: 12, backgroundColor: '#fff3cd', borderRadius: 6, fontSize: 14, color: '#856404' }}>
              💡 快速点击"捣"按钮进行捣练
            </div>
          )}
          {currentStage === 'molding' && poundingCount >= 50 && !selectedMold && (
            <div style={{ marginTop: 12, padding: 12, backgroundColor: '#fff3cd', borderRadius: 6, fontSize: 14, color: '#856404' }}>
              💡 拖拽物料至成型台模具上
            </div>
          )}
          {currentStage === 'drying' && (
            <div style={{ marginTop: 12, padding: 12, backgroundColor: '#d4edda', borderRadius: 6, fontSize: 14, color: '#155724' }}>
              ✓ 墨锭正在晾晒中，请耐心等待
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default React.memo(InkForm);
