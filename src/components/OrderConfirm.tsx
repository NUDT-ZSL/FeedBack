import React, { useState } from 'react';
import { OrderData, OrderResponse } from '../types';

interface OrderConfirmProps {
  orderData: OrderData;
  onUpdateRecipient: (name: string, blessing: string) => void;
  onOrderComplete: (orderId: string) => void;
  onBack: () => void;
}

const OrderConfirm: React.FC<OrderConfirmProps> = ({
  orderData,
  onUpdateRecipient,
  onOrderComplete,
  onBack,
}) => {
  const [recipientName, setRecipientName] = useState(orderData.recipientName);
  const [blessing, setBlessing] = useState(orderData.blessing);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!recipientName.trim()) {
      setError('请输入收件人姓名');
      return;
    }
    if (!blessing.trim()) {
      setError('请输入祝福语');
      return;
    }

    onUpdateRecipient(recipientName, blessing);
    setIsSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fillings: orderData.fillings,
          mold: orderData.mold,
          drawingData: orderData.drawingData,
          recipientName: recipientName.trim(),
          blessing: blessing.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error('提交订单失败');
      }

      const data: OrderResponse = await response.json();
      onOrderComplete(data.orderId);
    } catch (err) {
      setError('提交订单失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const fillingNames = orderData.fillings.map(f => f.name).join('、');

  return (
    <div style={styles.container} className="page-transition">
      <h2 style={styles.title}>确认订单</h2>

      <div style={styles.previewCard}>
        <h3 style={styles.sectionTitle}>糕点预览</h3>
        
        <div style={styles.pastryPreview}>
          {orderData.drawingData ? (
            <img 
              src={orderData.drawingData} 
              alt="定制糕点" 
              style={styles.pastryImage}
            />
          ) : (
            <div style={styles.pastryPlaceholder}>无图案</div>
          )}
        </div>

        <div style={styles.details}>
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>馅料：</span>
            <span style={styles.detailValue}>{fillingNames}</span>
          </div>
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>模具：</span>
            <span style={styles.detailValue}>{orderData.mold?.name || '未选择'}</span>
          </div>
        </div>
      </div>

      <div style={styles.formCard}>
        <h3 style={styles.sectionTitle}>订单信息</h3>
        
        <div style={styles.formGroup}>
          <label style={styles.label}>收件人姓名</label>
          <input
            type="text"
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            placeholder="请输入收件人姓名"
            style={styles.input}
            maxLength={20}
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>祝福语（最多50字）</label>
          <textarea
            value={blessing}
            onChange={(e) => setBlessing(e.target.value.slice(0, 50))}
            placeholder="请输入祝福语..."
            style={styles.textarea}
            maxLength={50}
          />
          <div style={styles.charCount}>{blessing.length}/50</div>
        </div>

        {error && <div style={styles.error}>{error}</div>}
      </div>

      <div style={styles.buttonBar}>
        <button className="btn-ancient" onClick={onBack} style={styles.backBtn}>
          返回修改
        </button>
        <button
          className="btn-ancient"
          onClick={handleSubmit}
          disabled={isSubmitting}
          style={styles.submitBtn}
        >
          {isSubmitting ? '提交中...' : '下订单'}
        </button>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    padding: '40px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    backgroundColor: '#f5e6d0',
  },
  title: {
    fontSize: '36px',
    color: '#c0392b',
    fontFamily: "'Ma Shan Zheng', cursive",
    marginBottom: '30px',
  },
  sectionTitle: {
    fontSize: '24px',
    color: '#c0392b',
    fontFamily: "'Ma Shan Zheng', cursive",
    marginBottom: '20px',
    textAlign: 'center',
  },
  previewCard: {
    backgroundColor: '#fff9f0',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '20px',
    width: '100%',
    maxWidth: '500px',
    border: '2px solid #d4ac0d',
  },
  pastryPreview: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '20px',
  },
  pastryImage: {
    width: '200px',
    height: '200px',
    borderRadius: '12px',
    objectFit: 'cover',
    border: '3px solid #d4ac0d',
  },
  pastryPlaceholder: {
    width: '200px',
    height: '200px',
    borderRadius: '12px',
    backgroundColor: '#f0e0d0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#999',
    border: '3px dashed #d4ac0d',
  },
  details: {
    borderTop: '1px solid #e0d5c0',
    paddingTop: '16px',
  },
  detailRow: {
    display: 'flex',
    marginBottom: '8px',
    fontSize: '16px',
  },
  detailLabel: {
    color: '#666',
    minWidth: '60px',
    fontWeight: 'bold',
  },
  detailValue: {
    color: '#333',
    flex: 1,
  },
  formCard: {
    backgroundColor: '#fff9f0',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '20px',
    width: '100%',
    maxWidth: '500px',
    border: '2px solid #d4ac0d',
  },
  formGroup: {
    marginBottom: '20px',
    position: 'relative',
  },
  label: {
    display: 'block',
    fontSize: '16px',
    color: '#333',
    marginBottom: '8px',
    fontWeight: 'bold',
  },
  input: {
    width: '100%',
    padding: '12px 16px',
    fontSize: '16px',
    border: '2px solid #e0d5c0',
    borderRadius: '8px',
    fontFamily: 'inherit',
    backgroundColor: '#fff',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  textarea: {
    width: '100%',
    padding: '12px 16px',
    fontSize: '16px',
    border: '2px solid #e0d5c0',
    borderRadius: '8px',
    fontFamily: 'inherit',
    backgroundColor: '#fff',
    outline: 'none',
    resize: 'none',
    minHeight: '100px',
    transition: 'border-color 0.2s',
  },
  charCount: {
    position: 'absolute',
    right: '8px',
    bottom: '-20px',
    fontSize: '12px',
    color: '#999',
  },
  error: {
    color: '#c0392b',
    fontSize: '14px',
    marginTop: '8px',
    textAlign: 'center',
  },
  buttonBar: {
    display: 'flex',
    gap: '20px',
    maxWidth: '500px',
    width: '100%',
    justifyContent: 'space-between',
  },
  backBtn: {
    minWidth: '120px',
  },
  submitBtn: {
    minWidth: '120px',
  },
};

export default OrderConfirm;
