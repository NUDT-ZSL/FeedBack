import { useState, useEffect, useRef } from 'react';
import {
  Volume2,
  Settings,
  Play,
  Square,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Move,
} from 'lucide-react';
import {
  RoomConfig,
  SoundSourceConfig,
  MaterialType,
  WallType,
  MATERIAL_PROPS,
  WALL_LABELS,
} from '@/types';

interface ControlPanelProps {
  room: RoomConfig;
  source: SoundSourceConfig;
  reverbEnabled: boolean;
  rt60: number;
  selectedWall: WallType | null;
  isCollapsed: boolean;
  isMobile: boolean;
  onWallMaterialChange: (wall: WallType, material: MaterialType) => void;
  onSourcePositionChange: (pos: [number, number, number]) => void;
  onToggleSimulation: () => void;
  onToggleReverb: () => void;
  onToggleCollapse: () => void;
  onRoomSizeChange: (dim: 'width' | 'height' | 'depth', value: number) => void;
}

const materials: MaterialType[] = ['glass', 'metal', 'wood', 'fabric'];

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

function MaterialButton({
  material,
  selected,
  onClick,
}: {
  material: MaterialType;
  selected: boolean;
  onClick: () => void;
}) {
  const [isAnimating, setIsAnimating] = useState(false);
  const props = MATERIAL_PROPS[material];

  useEffect(() => {
    if (selected) {
      setIsAnimating(true);
      const timer = setTimeout(() => setIsAnimating(false), 200);
      return () => clearTimeout(timer);
    }
  }, [selected]);

  return (
    <button
      onClick={onClick}
      title={props.label}
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        backgroundColor: props.color,
        border: selected ? '2px solid #e94560' : '2px solid transparent',
        cursor: 'pointer',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        transform: isAnimating ? 'scale(1.1)' : 'scale(1)',
        boxShadow: selected ? '0 0 12px rgba(233, 69, 96, 0.5)' : 'none',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        (e.target as HTMLButtonElement).style.transform = 'scale(1.1)';
        (e.target as HTMLButtonElement).style.filter = 'brightness(1.1)';
      }}
      onMouseLeave={(e) => {
        (e.target as HTMLButtonElement).style.transform = 'scale(1)';
        (e.target as HTMLButtonElement).style.filter = 'brightness(1)';
      }}
    />
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: 6,
        fontSize: 12,
        color: '#a0a0c0',
      }}>
        <span>{label}</span>
        <span style={{ color: '#ffdd57', fontFamily: 'monospace' }}>
          <AnimatedNumber value={value} decimals={1} />{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          width: '100%',
          height: 4,
          borderRadius: 2,
          background: '#0f3460',
          appearance: 'none',
          cursor: 'pointer',
          outline: 'none',
        }}
      />
      <style>{`
        input[type="range"]::-webkit-slider-thumb {
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #e94560;
          cursor: pointer;
          transition: transform 0.15s ease;
        }
        input[type="range"]::-webkit-slider-thumb:hover {
          transform: scale(1.2);
        }
      `}</style>
    </div>
  );
}

function CoordInput({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    }}>
      <span style={{
        width: 20,
        fontSize: 12,
        color: '#a0a0c0',
        fontWeight: 600,
      }}>{label}</span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          onClick={() => onChange(Math.max(min ?? -Infinity, value - step))}
          style={{
            width: 24,
            height: 24,
            border: 'none',
            borderRadius: 4,
            background: '#0f3460',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 'bold',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={(e) => (e.target as HTMLButtonElement).style.background = '#1a4a7a'}
          onMouseLeave={(e) => (e.target as HTMLButtonElement).style.background = '#0f3460'}
        >−</button>
        <input
          type="number"
          value={value}
          step={step}
          onChange={(e) => {
            let v = parseFloat(e.target.value);
            if (min !== undefined) v = Math.max(min, v);
            if (max !== undefined) v = Math.min(max, v);
            onChange(v);
          }}
          style={{
            flex: 1,
            height: 24,
            padding: '0 8px',
            border: '1px solid #0f3460',
            borderRadius: 4,
            background: '#0a1628',
            color: '#ffdd57',
            fontFamily: 'monospace',
            fontSize: 12,
            textAlign: 'center',
            outline: 'none',
          }}
        />
        <button
          onClick={() => onChange(Math.min(max ?? Infinity, value + step))}
          style={{
            width: 24,
            height: 24,
            border: 'none',
            borderRadius: 4,
            background: '#0f3460',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 'bold',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={(e) => (e.target as HTMLButtonElement).style.background = '#1a4a7a'}
          onMouseLeave={(e) => (e.target as HTMLButtonElement).style.background = '#0f3460'}
        >+</button>
      </div>
    </div>
  );
}

export function ControlPanel({
  room,
  source,
  reverbEnabled,
  rt60,
  selectedWall,
  isCollapsed,
  isMobile,
  onWallMaterialChange,
  onSourcePositionChange,
  onToggleSimulation,
  onToggleReverb,
  onToggleCollapse,
  onRoomSizeChange,
}: ControlPanelProps) {
  const sectionStyle: React.CSSProperties = {
    marginBottom: 20,
    paddingBottom: 16,
    borderBottom: '1px solid #0f3460',
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: '#e0e0ff',
    marginBottom: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  };

  if (isCollapsed) {
    return (
      <div
        onClick={onToggleCollapse}
        style={{
          width: 40,
          height: '100%',
          background: '#16213e',
          borderLeft: '1px solid #0f3460',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={(e) => (e.currentTarget as HTMLDivElement).style.background = '#1a2a4a'}
        onMouseLeave={(e) => (e.currentTarget as HTMLDivElement).style.background = '#16213e'}
      >
        <ChevronLeft size={20} color="#a0a0c0" />
      </div>
    );
  }

  const wallKeys: WallType[] = ['back', 'left', 'right', 'floor', 'ceiling'];

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: '#16213e',
      borderLeft: '1px solid #0f3460',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 16px',
        borderBottom: '1px solid #0f3460',
      }}>
        <h2 style={{
          fontSize: 16,
          fontWeight: 600,
          color: '#fff',
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <Settings size={18} color="#e94560" />
          控制面板
        </h2>
        <button
          onClick={onToggleCollapse}
          style={{
            width: 28,
            height: 28,
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
          <ChevronRight size={18} />
        </button>
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
        scrollbarWidth: 'thin',
        scrollbarColor: '#0f3460 transparent',
      }}>
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>
            <Volume2 size={16} color="#ffdd57" />
            房间尺寸
          </div>
          <Slider
            label="宽度 (X)"
            value={room.width}
            min={4}
            max={20}
            step={0.5}
            unit="m"
            onChange={(v) => onRoomSizeChange('width', v)}
          />
          <Slider
            label="高度 (Y)"
            value={room.height}
            min={2}
            max={10}
            step={0.5}
            unit="m"
            onChange={(v) => onRoomSizeChange('height', v)}
          />
          <Slider
            label="深度 (Z)"
            value={room.depth}
            min={3}
            max={15}
            step={0.5}
            unit="m"
            onChange={(v) => onRoomSizeChange('depth', v)}
          />
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>
            <Settings size={16} color="#e94560" />
            墙面材质
            {selectedWall && (
              <span style={{
                fontSize: 11,
                color: '#e94560',
                marginLeft: 'auto',
              }}>
                已选: {WALL_LABELS[selectedWall]}
              </span>
            )}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8,
            marginBottom: 12,
          }}>
            {materials.map((mat) => (
              <div key={mat} style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}>
                <MaterialButton
                  material={mat}
                  selected={selectedWall ? room.walls[selectedWall] === mat : false}
                  onClick={() => {
                    if (selectedWall) {
                      onWallMaterialChange(selectedWall, mat);
                    }
                  }}
                />
                <span style={{ fontSize: 10, color: '#a0a0c0' }}>
                  {MATERIAL_PROPS[mat].label}
                </span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#606080', fontStyle: 'italic' }}>
            点击3D场景中的墙面选中，再选择材质
          </div>

          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {wallKeys.map((wall) => (
              <button
                key={wall}
                onClick={() => onWallMaterialChange(wall, room.walls[wall] === 'wood' ? 'metal' : room.walls[wall] === 'metal' ? 'glass' : room.walls[wall] === 'glass' ? 'fabric' : 'wood')}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  border: `1px solid ${selectedWall === wall ? '#e94560' : '#0f3460'}`,
                  borderRadius: 4,
                  background: selectedWall === wall ? 'rgba(233, 69, 96, 0.1)' : 'transparent',
                  color: '#c0c0e0',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLButtonElement).style.background = 'rgba(15, 52, 96, 0.5)';
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLButtonElement).style.background = selectedWall === wall ? 'rgba(233, 69, 96, 0.1)' : 'transparent';
                }}
              >
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: MATERIAL_PROPS[room.walls[wall]].color,
                }} />
                {WALL_LABELS[wall]}
              </button>
            ))}
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>
            <Move size={16} color="#00d4ff" />
            声源位置
          </div>
          <CoordInput
            label="X"
            value={source.position[0]}
            step={0.5}
            min={-room.width / 2 + 0.5}
            max={room.width / 2 - 0.5}
            onChange={(v) => onSourcePositionChange([v, source.position[1], source.position[2]])}
          />
          <CoordInput
            label="Y"
            value={source.position[1]}
            step={0.5}
            min={0.5}
            max={room.height - 0.5}
            onChange={(v) => onSourcePositionChange([source.position[0], v, source.position[2]])}
          />
          <CoordInput
            label="Z"
            value={source.position[2]}
            step={0.5}
            min={-room.depth / 2 + 0.5}
            max={room.depth / 2 - 0.5}
            onChange={(v) => onSourcePositionChange([source.position[0], source.position[1], v])}
          />
        </div>

        <div style={sectionStyle}>
          <button
            onClick={onToggleSimulation}
            style={{
              width: '100%',
              padding: '12px 16px',
              border: 'none',
              borderRadius: 8,
              background: source.active ? '#e94560' : 'linear-gradient(135deg, #e94560, #ff6b8a)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              boxShadow: source.active ? '0 0 20px rgba(233, 69, 96, 0.4)' : '0 4px 12px rgba(233, 69, 96, 0.3)',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.transform = 'translateY(-1px)';
              (e.target as HTMLButtonElement).style.filter = 'brightness(1.1)';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.transform = 'translateY(0)';
              (e.target as HTMLButtonElement).style.filter = 'brightness(1)';
            }}
          >
            {source.active ? <Square size={16} /> : <Play size={16} />}
            {source.active ? '停止模拟' : '启动模拟'}
          </button>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>
            <Sparkles size={16} color="#a8d8ea" />
            混响模拟
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}>
            <span style={{ fontSize: 12, color: '#a0a0c0' }}>启用混响效果</span>
            <button
              onClick={onToggleReverb}
              style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                border: 'none',
                background: reverbEnabled ? '#e94560' : '#0f3460',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background 0.2s ease',
              }}
            >
              <div style={{
                position: 'absolute',
                top: 2,
                left: reverbEnabled ? 22 : 2,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: '#fff',
                transition: 'left 0.2s ease',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              }} />
            </button>
          </div>
          {reverbEnabled && (
            <div style={{
              padding: 12,
              background: '#0f3460',
              borderRadius: 8,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 11, color: '#a0a0c0', marginBottom: 4 }}>
                RT60 混响时间
              </div>
              <div style={{
                fontSize: 24,
                fontWeight: 700,
                color: '#ffdd57',
                fontFamily: 'monospace',
              }}>
                <AnimatedNumber value={rt60} decimals={2} />s
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
