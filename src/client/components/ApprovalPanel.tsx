import React, { useState } from 'react';
import { Evaluation } from '../types';

interface ApprovalPanelProps {
  evaluations: Evaluation[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

const ApprovalPanel: React.FC<ApprovalPanelProps> = ({
  evaluations,
  onApprove,
  onReject,
}) => {
  const [animatingId, setAnimatingId] = useState<string | null>(null);
  const [animationType, setAnimationType] = useState<
    'approve' | 'reject' | null
  >(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleApprove = (id: string) => {
    setAnimatingId(id);
    setAnimationType('approve');
    setTimeout(() => {
      onApprove(id);
      setAnimatingId(null);
      setAnimationType(null);
    }, 500);
  };

  const handleReject = (id: string) => {
    setAnimatingId(id);
    setAnimationType('reject');
    setTimeout(() => {
      onReject(id);
      setAnimatingId(null);
      setAnimationType(null);
    }, 400);
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const sortedEvals = [...evaluations].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div style={styles.panel}>
      <style>{animationCSS}</style>
      <h2 style={styles.heading}>📋 审核面板</h2>
      <div style={styles.count}>待审核：{sortedEvals.length} 条</div>
      {sortedEvals.length === 0 ? (
        <div style={styles.empty}>暂无待审核评价</div>
      ) : (
        <div style={styles.cardList}>
          {sortedEvals.map((evalItem) => {
            const isApproveAnim =
              animatingId === evalItem.id && animationType === 'approve';
            const isRejectAnim =
              animatingId === evalItem.id && animationType === 'reject';

            return (
              <div
                key={evalItem.id}
                className={
                  isApproveAnim
                    ? 'card-approve-anim'
                    : isRejectAnim
                    ? 'card-reject-anim'
                    : ''
                }
                style={styles.card}
              >
                <div style={styles.cardHeader}>
                  <div style={styles.stars}>
                    {[1, 2, 3, 4, 5].map((s) => (
                      <span
                        key={s}
                        style={{
                          color: s <= evalItem.rating ? '#FFD700' : '#555580',
                          fontSize: '16px',
                        }}
                      >
                        ★
                      </span>
                    ))}
                  </div>
                  <span style={styles.date}>
                    {new Date(evalItem.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
                <div style={styles.courseInfo}>
                  <span style={styles.courseTag}>{evalItem.courseName}</span>
                  <span style={styles.teacherTag}>{evalItem.teacher}</span>
                </div>
                <div
                  style={{
                    ...styles.commentBox,
                    WebkitLineClamp: expandedId === evalItem.id ? undefined : 3,
                    display:
                      expandedId === evalItem.id ? 'block' : '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                  onClick={() => toggleExpand(evalItem.id)}
                >
                  {evalItem.comment}
                </div>
                <div style={styles.btnGroup}>
                  <button
                    style={styles.approveBtn}
                    onClick={() => handleApprove(evalItem.id)}
                    disabled={animatingId !== null}
                  >
                    ✓ 通过
                  </button>
                  <button
                    style={styles.rejectBtn}
                    onClick={() => handleReject(evalItem.id)}
                    disabled={animatingId !== null}
                  >
                    ✗ 驳回
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const animationCSS = `
  @keyframes cardApprove {
    0% {
      opacity: 1;
      transform: translateX(0) translateY(0) scale(1);
    }
    100% {
      opacity: 0;
      transform: translateX(120px) translateY(-80px) scale(0.6);
    }
  }
  @keyframes cardReject {
    0% {
      opacity: 1;
      transform: scale(1);
    }
    100% {
      opacity: 0;
      transform: scale(0.3);
    }
  }
  .card-approve-anim {
    animation: cardApprove 0.5s ease-out forwards;
  }
  .card-reject-anim {
    animation: cardReject 0.4s ease-in forwards;
  }
`;

const styles: Record<string, React.CSSProperties> = {
  panel: {
    backgroundColor: '#2a2a3e',
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
    maxHeight: 'calc(100vh - 140px)',
    overflowY: 'auto',
  },
  heading: {
    fontSize: '20px',
    fontWeight: 600,
    color: '#ffb347',
    marginBottom: '8px',
    marginTop: 0,
  },
  count: {
    fontSize: '14px',
    color: '#8888aa',
    marginBottom: '16px',
  },
  empty: {
    textAlign: 'center',
    color: '#666688',
    padding: '40px 0',
    fontSize: '15px',
  },
  cardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  card: {
    backgroundColor: '#33334d',
    borderRadius: '12px',
    padding: '16px',
    boxShadow: '0 1px 6px rgba(0,0,0,0.2)',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  stars: {
    display: 'flex',
    gap: '2px',
  },
  date: {
    fontSize: '12px',
    color: '#666688',
  },
  courseInfo: {
    display: 'flex',
    gap: '8px',
    marginBottom: '10px',
  },
  courseTag: {
    fontSize: '13px',
    backgroundColor: '#3a3a5e',
    color: '#ffb347',
    padding: '3px 10px',
    borderRadius: '6px',
  },
  teacherTag: {
    fontSize: '13px',
    backgroundColor: '#3a3a5e',
    color: '#b0b0c0',
    padding: '3px 10px',
    borderRadius: '6px',
  },
  commentBox: {
    fontSize: '14px',
    lineHeight: '1.6',
    color: '#c0c0d0',
    cursor: 'pointer',
    marginBottom: '12px',
    textOverflow: 'ellipsis',
  },
  btnGroup: {
    display: 'flex',
    gap: '10px',
  },
  approveBtn: {
    flex: 1,
    padding: '8px 16px',
    borderRadius: '12px',
    border: 'none',
    backgroundColor: '#2e7d32',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background-color 0.2s ease',
  },
  rejectBtn: {
    flex: 1,
    padding: '8px 16px',
    borderRadius: '12px',
    border: 'none',
    backgroundColor: '#c62828',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background-color 0.2s ease',
  },
};

export default ApprovalPanel;
