import { useState, useEffect, useRef } from 'react';
import {
  BarChart3,
  Activity,
  Repeat,
  X,
  Info,
} from 'lucide-react';
import {
  SimulationStats,
  HitDetail,
  MATERIAL_PROPS,
  WALL_LABELS,
  MaterialType,
  WallType,
} from '@/types';

interface InfoPanelProps {
  stats: SimulationStats;
  active: boolean;
  hitDetail: HitDetail | null;
  onCloseDetail: () => void;
}

function AnimatedNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [display, setDisplay] = useState(value);
  const prevValue = useRef(value);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    const start = prevValue.current;
    const end = value;
    const duration = 300;
    const startTime = performance.now();

    const animate = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + (end - start) * eased);
      if (progress < 1) {
        animRef.current = requestAnimationFrame(animate);
      } else {
        prevValue.current = value;
      }
    };

    animRef.current = requestAnimationFrame(animate);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [value]);

  return <span>{display.toFixed(decimals)}</span>;
}

function StatCard({
  icon: Icon,
  label,
  value,
  decimals = 0,
  color,
}: {
  icon: any;
  label: string;
  value: number;
  decimals?: number;
  color: string;
}) {
  return (
    <div style={{
      flex: 1,
      background: '#0f3460',
      borderRadius: 8,
      padding: 12,
      textAlign: 'center',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        marginBottom: 6,
      }}>
        <Icon size={14} color={color} />
        <span style={{ fontSize: 11, color: '#a0a0c0' }}>{label}</span>
      </div>
      <div style={{
        fontSize: 20,
        fontWeight: 700,
        color: color,
        fontFamily: 'monospace',
      }}>
        <AnimatedNumber value={value} decimals={decimals} />
      </div>
    </div>
  );
}

function BarChart({
  data,
  labels,
  colors,
  title,
}: {
  data: number[];
  labels: string[];
  colors: string[];
  title: string;
}) {
  const [animated, setAnimated] = useState(false);
  const maxValue = Math.max(...data, 1);

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(true), 100);
    return () => clearTimeout(timer);
  }, [data]);

  return (
    <div style={{
      background: '#0a1628',
      borderRadius: 8,
      padding: 12,
    }}>
      <div style={{
        fontSize: 12,
        color: '#a0a0c0',
        marginBottom: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <BarChart3 size={14} color="#e94560" />
        {title}
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-around',
        height: 80,
        gap: 8,
      }}>
        {data.map((value, i) => (
          <div key={i} style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            height: '100%',
            justifyContent: 'flex-end',
          }}>
            <div style={{
              fontSize: 10,
              color: '#ffdd57',
              fontFamily: 'monospace',
              marginBottom: 4,
              opacity: animated && value > 0 ? 1 : 0,
              transition: 'opacity 0.5s ease 0.3s',
            }}>
              {value}
            </div>
            <div style={{
              width: '100%',
              maxWidth: 28,
              height: animated ? `${(value / maxValue) * 60}px` : 0,
              background: colors[i],
              borderRadius: '4px 4px 0 0',
              transition: 'height 0.5s ease-out',
              boxShadow: `0 0 8px ${colors[i]}40`,
              minHeight: value > 0 ? 2 : 0,
            }} />
            <div style={{
              fontSize: 9,
              color: '#606080',
              marginTop: 4,
              textAlign: 'center',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
            }}>
              {labels[i]}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailCard({ detail, onClose }: { detail: HitDetail; onClose: () => void }) {
  const materialProps = detail.material ? MATERIAL_PROPS[detail.material] : null;

  return (
    <div style={{
      position: 'absolute',
      top: 16,
      left: 16,
      right: 16,
      background: '#16213e',
      border: '1px solid #e94560',
      borderRadius: 12,
      padding: 16,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      zIndex: 10,
      animation: 'slideIn 0.3s ease-out',
    }}>
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          fontWeight: 600,
          color: '#fff',
        }}>
          <Info size={16} color="#e94560" />
          {detail.type === 'bounce' ? '撞击点详情' : '射线详情'}
        </div>
        <button
          onClick={onClose}
          style={{
            width: 24,
            height: 24,
            border: 'none',
            borderRadius: 6,
            background: 'transparent',
            color: '#a0a0c0',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={(e) => (e.target as HTMLButtonElement).style.background = '#0f3460'}
          onMouseLeave={(e) => (e.target as HTMLButtonElement).style.background = 'transparent'}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: '#606080', marginBottom: 2 }}>射线ID</div>
          <div style={{ fontSize: 13, color: '#ffdd57', fontFamily: 'monospace' }}>
            #{detail.rayId}
          </div>
        </div>

        {detail.wall && (
          <div>
            <div style={{ fontSize: 10, color: '#606080', marginBottom: 2 }}>墙面</div>
            <div style={{ fontSize: 13, color: '#e0e0ff' }}>
              {WALL_LABELS[detail.wall]}
            </div>
          </div>
        )}

        {detail.material && materialProps && (
          <div>
            <div style={{ fontSize: 10, color: '#606080', marginBottom: 2 }}>材质</div>
            <div style={{
              fontSize: 13,
              color: '#e0e0ff',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <span style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: materialProps.color,
              }} />
              {materialProps.label}
            </div>
          </div>
        )}

        {detail.incidentAngle !== undefined && (
          <div>
            <div style={{ fontSize: 10, color: '#606080', marginBottom: 2 }}>入射角</div>
            <div style={{ fontSize: 13, color: '#00d4ff', fontFamily: 'monospace' }}>
              {detail.incidentAngle.toFixed(1)}°
            </div>
          </div>
        )}

        {detail.reflectAngle !== undefined && (
          <div>
            <div style={{ fontSize: 10, color: '#606080', marginBottom: 2 }}>反射角</div>
            <div style={{ fontSize: 13, color: '#00d4ff', fontFamily: 'monospace' }}>
              {detail.reflectAngle.toFixed(1)}°
            </div>
          </div>
        )}

        {detail.energyRemaining !== undefined && (
          <div>
            <div style={{ fontSize: 10, color: '#606080', marginBottom: 2 }}>能量保留</div>
            <div style={{ fontSize: 13, color: '#e94560', fontFamily: 'monospace' }}>
              {(detail.energyRemaining * 100).toFixed(1)}%
            </div>
          </div>
        )}

        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ fontSize: 10, color: '#606080', marginBottom: 2 }}>位置</div>
          <div style={{ fontSize: 12, color: '#a0a0c0', fontFamily: 'monospace' }}>
            X: {detail.position[0].toFixed(2)} | Y: {detail.position[1].toFixed(2)} | Z: {detail.position[2].toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function InfoPanel({ stats, active, hitDetail, onCloseDetail }: InfoPanelProps) {
  const materialKeys = Object.keys(stats.materialHitCounts) as MaterialType[];
  const wallKeys: WallType[] = ['back', 'left', 'right', 'floor', 'ceiling'];

  const materialData = materialKeys.map(k => stats.materialHitCounts[k]);
  const materialLabels = materialKeys.map(k => MATERIAL_PROPS[k].label);
  const materialColors = materialKeys.map(k => MATERIAL_PROPS[k].color);

  const wallData = wallKeys.map(k => stats.wallHitCounts[k]);
  const wallLabels = wallKeys.map(k => WALL_LABELS[k]);
  const wallColors = wallKeys.map(() => '#0f3460');

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      pointerEvents: hitDetail ? 'auto' : 'none',
    }}>
      {hitDetail && <DetailCard detail={hitDetail} onClose={onCloseDetail} />}

      <div style={{
        marginTop: hitDetail ? 180 : 0,
        flex: 1,
        overflowY: 'auto',
        pointerEvents: 'auto',
        padding: '0 16px 16px',
      }}>
        <div style={{
          display: 'flex',
          gap: 10,
          marginBottom: 16,
        }}>
          <StatCard
            icon={Activity}
            label="射线总数"
            value={stats.totalRays}
            color="#ffdd57"
          />
          <StatCard
            icon={Repeat}
            label="平均弹射"
            value={stats.averageBounces}
            decimals={1}
            color="#00d4ff"
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <BarChart
            data={wallData}
            labels={wallLabels}
            colors={['#e94560', '#ff8800', '#ffdd57', '#8b5a2b', '#a8d8ea']}
            title="墙面撞击次数"
          />
        </div>

        <div>
          <BarChart
            data={materialData}
            labels={materialLabels}
            colors={materialColors}
            title="材质分布统计"
          />
        </div>

        {!active && (
          <div style={{
            marginTop: 16,
            padding: 12,
            background: 'rgba(15, 52, 96, 0.5)',
            borderRadius: 8,
            textAlign: 'center',
            fontSize: 11,
            color: '#606080',
            fontStyle: 'italic',
          }}>
            点击"启动模拟"开始射线追踪
          </div>
        )}
      </div>
    </div>
  );
}
