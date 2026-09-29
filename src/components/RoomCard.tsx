import { useState, useRef, useEffect } from 'react';
import { EscapeRecord, ThemeType, RoleType, Teammate } from '../types';

interface RoomCardProps {
  record: EscapeRecord;
  onDelete: (id: string) => void;
}

const themeGradients: Record<ThemeType, string> = {
  恐怖: 'linear-gradient(135deg, #8B0000 0%, #DC143C 100%)',
  悬疑: 'linear-gradient(135deg, #4B0082 0%, #8A2BE2 100%)',
  科幻: 'linear-gradient(135deg, #00008B 0%, #4169E1 100%)',
  古风: 'linear-gradient(135deg, #2F4F4F 0%, #556B2F 100%)',
  搞笑: 'linear-gradient(135deg, #FF8C00 0%, #FFD700 100%)',
};

const roleColors: Record<RoleType, string> = {
  脑力: '#4FC3F7',
  体力: '#FF7043',
  侦察: '#66BB6A',
  指挥: '#BA68C8',
  搞笑: '#FFCA28',
};

const roleIcons: Record<RoleType, string> = {
  脑力: '🧠',
  体力: '💪',
  侦察: '🔍',
  指挥: '🎯',
  搞笑: '😄',
};

export default function RoomCard({ record, onDelete }: RoomCardProps) {
  const [translateX, setTranslateX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [expandedTeammate, setExpandedTeammate] = useState<string | null>(null);
  const [showTeammates, setShowTeammates] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const currentXRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowTeammates(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    startXRef.current = e.clientX;
    currentXRef.current = 0;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const diff = e.clientX - startXRef.current;
    const newTranslate = Math.min(0, Math.max(-window.innerWidth * 0.5, diff));
    currentXRef.current = newTranslate;
    setTranslateX(newTranslate);
  };

  const handleMouseUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    const cardWidth = cardRef.current?.offsetWidth || 0;
    const threshold = cardWidth * 0.4;

    if (Math.abs(translateX) > threshold) {
      setShowConfirm(true);
      setTranslateX(0);
    } else {
      setTranslateX(0);
    }
  };

  const handleMouseLeave = () => {
    if (isDragging) {
      handleMouseUp();
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    startXRef.current = e.touches[0].clientX;
    currentXRef.current = 0;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const diff = e.touches[0].clientX - startXRef.current;
    const newTranslate = Math.min(0, Math.max(-window.innerWidth * 0.5, diff));
    currentXRef.current = newTranslate;
    setTranslateX(newTranslate);
  };

  const handleTouchEnd = () => {
    handleMouseUp();
  };

  const confirmDelete = () => {
    setIsDeleting(true);
    setShowConfirm(false);
    setTimeout(() => {
      onDelete(record.id);
    }, 300);
  };

  const cancelDelete = () => {
    setShowConfirm(false);
    setTranslateX(0);
  };

  const toggleTeammateExpand = (teammateId: string) => {
    setExpandedTeammate(expandedTeammate === teammateId ? null : teammateId);
  };

  return (
    <div style={{ position: 'relative', marginBottom: '16px' }}>
      <div
        ref={cardRef}
        style={{
          background: themeGradients[record.theme],
          borderRadius: '12px',
          padding: '20px',
          boxShadow: '0 4px 15px rgba(233,69,96,0.15)',
          position: 'relative',
          overflow: 'hidden',
          cursor: isDragging ? 'grabbing' : 'grab',
          transform: isDeleting
            ? `translateX(-120%)`
            : `translateX(${translateX}px)`,
          transition: isDragging ? 'none' : 'transform 0.3s ease-in',
          userSelect: 'none',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="theme-tag"
          style={{
            display: 'inline-block',
            padding: '4px 12px',
            borderRadius: '20px',
            backgroundColor: 'rgba(255,255,255,0.25)',
            color: '#fff',
            fontSize: '13px',
            fontWeight: 500,
            marginBottom: '12px',
            transition: 'all 0.25s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.1)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          {record.theme}
        </div>

        <h3 style={{ color: '#fff', fontSize: '20px', fontWeight: 600, margin: '0 0 6px 0' }}>
          {record.name}
        </h3>
        <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', margin: '0 0 16px 0' }}>
          {record.storeName}
        </p>

        <div style={{ display: 'flex', gap: '12px', fontSize: '13px', color: 'rgba(255,255,255,0.7)' }}>
          <span>👥 {record.playerCount}人</span>
          <span>⏱️ 限时{record.timeLimit}分钟</span>
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: '20px',
            right: '20px',
            textAlign: 'right',
          }}
        >
          {record.escaped ? (
            <div style={{ color: '#fff', fontSize: '18px', fontWeight: 600 }}>
              {record.actualTime}分钟
            </div>
          ) : (
            <div
              className="not-escaped"
              style={{
                color: '#ff3333',
                fontSize: '18px',
                fontWeight: 700,
                animation: 'blink 0.66s infinite',
                textShadow: '0 0 10px rgba(255,0,0,0.5)',
              }}
            >
              未逃脱
            </div>
          )}
        </div>
      </div>

      {record.teammates.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: '10px',
            marginTop: '12px',
            overflowX: 'auto',
            paddingBottom: '4px',
          }}
        >
          {record.teammates.map((teammate, index) => (
            <TeammateCard
              key={teammate.id}
              teammate={teammate}
              delay={index * 100}
              show={showTeammates}
              isExpanded={expandedTeammate === teammate.id}
              onToggle={() => toggleTeammateExpand(teammate.id)}
            />
          ))}
        </div>
      )}

      {showConfirm && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'fadeIn 0.2s ease',
          }}
          onClick={cancelDelete}
        >
          <div
            style={{
              backgroundColor: '#16213E',
              borderRadius: '12px',
              padding: '28px',
              minWidth: '280px',
              animation: 'scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
              boxShadow: '0 4px 15px rgba(233,69,96,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h4 style={{ color: '#E0E0E0', margin: '0 0 12px 0', fontSize: '18px' }}>
              确认删除
            </h4>
            <p style={{ color: 'rgba(224,224,224,0.7)', margin: '0 0 20px 0', fontSize: '14px' }}>
              确定要删除这条密室记录吗？
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={cancelDelete}
                style={{
                  padding: '8px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  color: '#E0E0E0',
                  fontSize: '14px',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                }}
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                style={{
                  padding: '8px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: '#E94560',
                  color: '#fff',
                  fontSize: '14px',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#d63850';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#E94560';
                }}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { transform: scale(0.8); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes slideInRight {
          from { transform: translateX(40px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

interface TeammateCardProps {
  teammate: Teammate;
  delay: number;
  show: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

function TeammateCard({ teammate, delay, show, isExpanded, onToggle }: TeammateCardProps) {
  return (
    <div
      onClick={onToggle}
      style={{
        flexShrink: 0,
        backgroundColor: '#16213E',
        borderRadius: '12px',
        padding: '12px 16px',
        minWidth: '160px',
        cursor: 'pointer',
        boxShadow: '0 4px 15px rgba(233,69,96,0.15)',
        transform: isExpanded ? 'scale(1.2)' : 'scale(1)',
        transition: 'transform 0.3s ease',
        opacity: show ? 1 : 0,
        transformOrigin: 'left center',
        animation: show ? `slideInRight 0.35s ease-out ${delay}ms forwards` : 'none',
        zIndex: isExpanded ? 10 : 1,
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            border: `2px solid ${roleColors[teammate.role]}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '18px',
            backgroundColor: 'rgba(255,255,255,0.05)',
            transition: 'all 0.2s ease',
          }}
        >
          {roleIcons[teammate.role]}
        </div>
        <div>
          <div style={{ color: '#E0E0E0', fontWeight: 500, fontSize: '14px' }}>
            {teammate.name}
          </div>
          <div
            style={{
              color: roleColors[teammate.role],
              fontSize: '11px',
            }}
          >
            {teammate.role}
          </div>
        </div>
      </div>
      <p style={{ color: 'rgba(224,224,224,0.6)', fontSize: '12px', margin: 0, lineHeight: 1.4 }}>
        {teammate.comment}
      </p>
    </div>
  );
}
