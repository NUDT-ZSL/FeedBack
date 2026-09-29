import { useState, useRef, useCallback, useEffect } from 'react';
import type { TaskCategory } from '../types';
import { CATEGORY_COLORS } from '../types';
import { FaMapMarkerAlt, FaUsers, FaCheckCircle, FaHandHoldingHeart } from 'react-icons/fa';

interface TaskCardProps {
  task: Task;
  onClaim: (taskId: string) => void;
  onOpenFeedback: (taskId: string) => void;
}

interface Task {
  id: string;
  title: string;
  category: TaskCategory;
  location: string;
  requiredCount: number;
  claimedCount: number;
  description: string;
  createdAt: number;
  isClaimed: boolean;
  feedback?: {
    id: string;
    taskId: string;
    description: string;
    imageUrl?: string;
    submittedAt: number;
  };
}

export default function TaskCard({ task, onClaim, onOpenFeedback }: TaskCardProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const color = CATEGORY_COLORS[task.category];
  const remaining = task.requiredCount - task.claimedCount;

  const handleClaimClick = useCallback(() => {
    setShowConfirm(true);
    setIsAnimating(true);
  }, []);

  const handleConfirmClaim = useCallback(() => {
    onClaim(task.id);
    setShowConfirm(false);
    setIsAnimating(false);
  }, [task.id, onClaim]);

  const handleCancel = useCallback(() => {
    setShowConfirm(false);
    setIsAnimating(false);
  }, []);

  useEffect(() => {
    if (!showConfirm) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
      if (e.key === 'Enter') handleConfirmClaim();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [showConfirm, handleCancel, handleConfirmClaim]);

  const getSummary = (text: string) => {
    return text.length > 60 ? text.slice(0, 60) + '...' : text;
  };

  return (
    <div
      ref={cardRef}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        overflow: 'hidden',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        background: task.isClaimed ? 'rgba(230,230,230,0.85)' : 'rgba(255,255,255,0.85)',
        transition: 'all 0.25s ease-out',
        transform: 'translateZ(0)',
        willChange: 'transform'
      }}
    >
      <div style={{ display: 'flex', minHeight: '140px' }}>
        <div
          style={{
            width: '6px',
            flexShrink: 0,
            background: color,
            borderRadius: '12px 0 0 12px'
          }}
        />

        <div style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
            <h3 style={{
              margin: 0,
              fontSize: '17px',
              fontWeight: 600,
              color: '#333',
              lineHeight: 1.4
            }}>
              {task.title}
            </h3>
            {task.feedback && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 10px',
                borderRadius: '12px',
                background: '#E8F5E9',
                color: '#2E7D32',
                fontSize: '12px',
                fontWeight: 500,
                flexShrink: 0,
                whiteSpace: 'nowrap'
              }}>
                <FaCheckCircle size={12} />
                已反馈
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', fontSize: '13px', color: '#666' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <FaMapMarkerAlt size={13} color={color} />
              {task.location}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <FaUsers size={13} color={color} />
              {task.requiredCount}人
            </span>
          </div>

          <p style={{
            margin: 0,
            fontSize: '13.5px',
            color: '#555',
            lineHeight: 1.55
          }}>
            {getSummary(task.description)}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: '6px' }}>
            <span style={{
              fontSize: '13px',
              fontWeight: 500,
              color: remaining > 0 ? color : '#999'
            }}>
              剩余名额：{Math.max(remaining, 0)} 人
            </span>

            <div style={{ display: 'flex', gap: '8px' }}>
              {task.isClaimed && !task.feedback && (
                <button
                  onClick={() => onOpenFeedback(task.id)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: color,
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    transition: 'all 0.25s ease-out',
                    transform: 'translateZ(0)'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.08)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  <FaHandHoldingHeart size={13} />
                  提交反馈
                </button>
              )}

              {task.isClaimed ? (
                <button
                  disabled
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: '#BDBDBD',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'not-allowed',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    transition: 'all 0.3s ease-out'
                  }}
                >
                  <FaCheckCircle size={13} />
                  已认领
                </button>
              ) : (
                <button
                  onClick={handleClaimClick}
                  disabled={remaining <= 0}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: remaining > 0 ? '#2196F3' : '#BDBDBD',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: remaining > 0 ? 'pointer' : 'not-allowed',
                    transition: 'all 0.25s ease-out',
                    transform: 'translateZ(0)'
                  }}
                  onMouseEnter={(e) => { if (remaining > 0) { e.currentTarget.style.filter = 'brightness(1.08)'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  认领任务
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showConfirm && (
        <>
          <div
            onClick={handleCancel}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.4)',
              zIndex: 998,
              opacity: isAnimating ? 1 : 0,
              transition: 'opacity 0.3s ease-out',
              backdropFilter: 'blur(2px)'
            }}
          />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: `translate(-50%, -50%) scale(${isAnimating ? 1 : 0.7})`,
              opacity: isAnimating ? 1 : 0,
              transition: 'all 0.3s ease-out',
              zIndex: 999,
              background: '#fff',
              borderRadius: '16px',
              padding: '28px 24px',
              width: 'min(92vw, 360px)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
              willChange: 'transform, opacity'
            }}
          >
            <h4 style={{ margin: '0 0 10px', fontSize: '18px', fontWeight: 600, color: '#333' }}>
              确认认领任务
            </h4>
            <p style={{ margin: '0 0 22px', fontSize: '14px', color: '#666', lineHeight: 1.6 }}>
              您确定要认领「<span style={{ color: '#2196F3', fontWeight: 500 }}>{task.title}</span>」吗？认领后请认真完成哦~
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={handleCancel}
                style={{
                  flex: 1,
                  padding: '11px',
                  borderRadius: '10px',
                  border: '1.5px solid #E0E0E0',
                  background: '#FAFAFA',
                  color: '#555',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease-out'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#F0F0F0'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
              >
                取消
              </button>
              <button
                onClick={handleConfirmClaim}
                style={{
                  flex: 1,
                  padding: '11px',
                  borderRadius: '10px',
                  border: 'none',
                  background: '#2196F3',
                  color: '#fff',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease-out'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; }}
              >
                确认认领
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
