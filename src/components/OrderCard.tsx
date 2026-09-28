import { useState, useEffect, useCallback } from 'react';
import type { Order } from '../types';
import { calculateDuration } from '../data';
import styles from './OrderCard.module.css';

interface OrderCardProps {
  order: Order;
  onStartMaking: (orderId: string) => void;
  onComplete: (orderId: string) => void;
  isFlashing: boolean;
}

function formatCountdown(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatDate(date: Date): string {
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusText(status: Order['status']): string {
  switch (status) {
    case 'pending': return '待处理';
    case 'in-progress': return '制作中';
    case 'completed': return '已完成';
  }
}

export default function OrderCard({ order, onStartMaking, onComplete, isFlashing }: OrderCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [remainingTime, setRemainingTime] = useState<number>(0);

  useEffect(() => {
    if (order.status !== 'in-progress' || !order.startedAt || !order.estimatedDuration) {
      return;
    }

    const updateRemaining = () => {
      const now = Date.now();
      const startedAt = order.startedAt!.getTime();
      const durationMs = order.estimatedDuration! * 60 * 1000;
      const elapsed = now - startedAt;
      const remaining = durationMs - elapsed;
      
      if (remaining <= 0) {
        onComplete(order.id);
        return;
      }
      setRemainingTime(remaining);
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);
    return () => clearInterval(interval);
  }, [order.status, order.startedAt, order.estimatedDuration, order.id, onComplete]);

  const handleCardClick = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  const handleStartClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowConfirm(true);
  }, []);

  const handleConfirmStart = useCallback(() => {
    setShowConfirm(false);
    onStartMaking(order.id);
  }, [order.id, onStartMaking]);

  const handleCancelConfirm = useCallback(() => {
    setShowConfirm(false);
  }, []);

  const statusClass = order.status === 'pending' ? styles.pending :
                     order.status === 'in-progress' ? styles.inProgress :
                     `${styles.completed} ${isFlashing ? styles.flash : ''}`;

  const duration = order.estimatedDuration || calculateDuration(order.layers);
  const durationText = `${Math.floor(duration / 60)}小时${duration % 60 > 0 ? duration % 60 + '分钟' : ''}`;

  return (
    <>
      <div className={styles.orderCard} onClick={handleCardClick}>
        <div className={`${styles.statusTag} ${statusClass}`}>
          {getStatusText(order.status)}
        </div>
        
        <div className={styles.cardHeader}>
          <span className={styles.orderId}>订单 #{order.id}</span>
          <span className={styles.submittedAt}>{formatDate(order.submittedAt)}</span>
        </div>

        <div className={`${styles.cardContent} ${isExpanded ? styles.expanded : ''}`}>
          <div className={styles.orderInfo}>
            <div className={styles.infoItem}>
              <div className={styles.infoLabel}>蛋糕尺寸</div>
              <div className={styles.infoValue}>{order.size}英寸</div>
            </div>
            <div className={styles.infoItem}>
              <div className={styles.infoLabel}>层数</div>
              <div className={styles.infoValue}>{order.layers}层</div>
            </div>
            <div className={styles.infoItem}>
              <div className={styles.infoLabel}>口味</div>
              <div className={styles.infoValue}>{order.flavor}</div>
            </div>
            <div className={styles.infoItem}>
              <div className={styles.infoLabel}>预计制作时间</div>
              <div className={styles.infoValue}>{durationText}</div>
            </div>
          </div>

          {order.decorationNote && (
            <div className={styles.decorationNote}>
              <div className={styles.noteLabel}>🎂 装饰备注</div>
              <div className={styles.noteText}>{order.decorationNote}</div>
            </div>
          )}

          {order.status === 'in-progress' && (
            <div className={styles.countdown}>
              <div className={styles.countdownLabel}>⏱️ 剩余制作时间</div>
              <div className={styles.countdownTimer}>{formatCountdown(remainingTime)}</div>
            </div>
          )}

          <div className={styles.cardActions}>
            {order.status === 'pending' && (
              <button 
                className={`${styles.actionBtn} ${styles.primaryBtn}`}
                onClick={handleStartClick}
              >
                开始制作
              </button>
            )}
            {order.status === 'in-progress' && (
              <button 
                className={`${styles.actionBtn} ${styles.secondaryBtn}`}
                onClick={(e) => { e.stopPropagation(); onComplete(order.id); }}
              >
                标记为已完成
              </button>
            )}
            {order.status === 'completed' && (
              <button 
                className={`${styles.actionBtn} ${styles.secondaryBtn}`}
                disabled
              >
                ✓ 已完成
              </button>
            )}
          </div>
        </div>
      </div>

      {showConfirm && (
        <div className={styles.modalOverlay} onClick={handleCancelConfirm}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>确认开始制作？</div>
            <div className={styles.modalMessage}>
              即将开始制作 {order.size}英寸 {order.flavor}口味蛋糕（{order.layers}层）。
              <br /><br />
              预计制作时间：{durationText}
            </div>
            <div className={styles.modalActions}>
              <button className={`${styles.modalBtn} ${styles.cancelBtn}`} onClick={handleCancelConfirm}>
                取消
              </button>
              <button className={`${styles.modalBtn} ${styles.confirmBtn}`} onClick={handleConfirmStart}>
                确认开始
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
