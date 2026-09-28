import React, { useState } from 'react';
import { OKR, calculateWeightedProgress, formatDate, getDaysRemaining } from '@/utils/helpers';

interface OKRListProps {
  okrs: OKR[];
  loading?: boolean;
  onSelectOKR?: (okrId: string) => void;
}

export const OKRList: React.FC<OKRListProps> = ({ okrs, loading = false, onSelectOKR }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleCardClick = (okrId: string) => {
    if (expandedId === okrId) {
      setExpandedId(null);
    } else {
      setExpandedId(okrId);
    }
    if (onSelectOKR) {
      onSelectOKR(okrId);
    }
  };

  const getProgressColor = (progress: number) => {
    if (progress >= 80) return '#00b4d8';
    if (progress >= 50) return '#48cae4';
    return '#e63946';
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {[1, 2, 3].map(i => (
          <div
            key={i}
            style={{
              padding: '24px',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '16px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              animation: 'pulse 1.5s ease-in-out infinite'
            }}
          >
            <div style={{ height: '24px', width: '60%', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '4px' }} />
            <div style={{ marginTop: '16px', height: '8px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '4px' }} />
            <div style={{ marginTop: '12px', height: '16px', width: '30%', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '4px' }} />
          </div>
        ))}
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {okrs.map(okr => {
        const progress = calculateWeightedProgress(okr.keyResults);
        const daysRemaining = getDaysRemaining(okr.deadline);
        const isExpanded = expandedId === okr.id;

        return (
          <div
            key={okr.id}
            onClick={() => handleCardClick(okr.id)}
            style={{
              padding: '24px',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '16px',
              border: `1px solid ${isExpanded ? 'rgba(0, 180, 216, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              transform: isExpanded ? 'translateY(-2px)' : 'translateY(0)',
              boxShadow: isExpanded ? '0 10px 40px rgba(0, 180, 216, 0.1)' : 'none'
            }}
            onMouseEnter={(e) => {
              if (!isExpanded) {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255, 255, 255, 0.15)';
                (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isExpanded) {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255, 255, 255, 0.08)';
                (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
              }
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <span
                    style={{
                      padding: '4px 10px',
                      backgroundColor: 'rgba(230, 57, 70, 0.2)',
                      color: '#e63946',
                      fontSize: '12px',
                      fontWeight: 600,
                      borderRadius: '6px',
                      fontFamily: "'Inter', sans-serif"
                    }}
                  >
                    {okr.quarter}
                  </span>
                  {daysRemaining > 0 && daysRemaining <= 30 && (
                    <span
                      style={{
                        padding: '4px 10px',
                        backgroundColor: 'rgba(230, 57, 70, 0.15)',
                        color: '#e63946',
                        fontSize: '11px',
                        borderRadius: '6px',
                        fontFamily: "'Inter', sans-serif"
                      }}
                    >
                      剩余 {daysRemaining} 天
                    </span>
                  )}
                </div>
                <h3
                  style={{
                    margin: '0 0 12px 0',
                    fontSize: '18px',
                    fontWeight: 600,
                    color: '#fff',
                    fontFamily: "'Inter', sans-serif"
                  }}
                >
                  {okr.title}
                </h3>
              </div>

              <div style={{ flexShrink: 0, textAlign: 'right' }}>
                <div
                  style={{
                    fontSize: '32px',
                    fontWeight: 700,
                    color: getProgressColor(progress),
                    fontFamily: "'Inter', sans-serif",
                    lineHeight: 1
                  }}
                >
                  {progress}%
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: 'rgba(255, 255, 255, 0.5)',
                    marginTop: '4px',
                    fontFamily: "'Inter', sans-serif"
                  }}
                >
                  完成度
                </div>
              </div>
            </div>

            <div
              style={{
                width: '100%',
                height: '8px',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                borderRadius: '4px',
                overflow: 'hidden',
                marginTop: '16px'
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  backgroundColor: getProgressColor(progress),
                  borderRadius: '4px',
                  transition: 'width 0.5s ease',
                  boxShadow: `0 0 10px ${getProgressColor(progress)}`
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '12px',
                fontSize: '12px',
                color: 'rgba(255, 255, 255, 0.5)',
                fontFamily: "'Inter', sans-serif"
              }}
            >
              <span>{okr.keyResults.length} 个关键结果</span>
              <span>截止: {formatDate(okr.deadline)}</span>
            </div>

            {isExpanded && (
              <div
                style={{
                  marginTop: '20px',
                  paddingTop: '20px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  animation: 'slideDown 0.3s ease'
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {okr.keyResults.map((kr, idx) => (
                    <div
                      key={kr.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px 16px',
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: '10px'
                      }}
                    >
                      <span
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          backgroundColor: 'rgba(0, 180, 216, 0.2)',
                          color: '#00b4d8',
                          fontSize: '12px',
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          fontFamily: "'Inter', sans-serif"
                        }}
                      >
                        {idx + 1}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p
                          style={{
                            margin: 0,
                            fontSize: '13px',
                            color: 'rgba(255, 255, 255, 0.85)',
                            fontFamily: "'Inter', sans-serif",
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                        >
                          {kr.title}
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span
                          style={{
                            fontSize: '11px',
                            color: 'rgba(255, 255, 255, 0.5)',
                            fontFamily: "'Inter', sans-serif"
                          }}
                        >
                          权重 {kr.weight}%
                        </span>
                        <span
                          style={{
                            fontSize: '14px',
                            fontWeight: 600,
                            color: getProgressColor(kr.progress),
                            fontFamily: "'Inter', sans-serif",
                            minWidth: '45px',
                            textAlign: 'right'
                          }}
                        >
                          {kr.progress}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <style>{`
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
};
