import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { SavedOrder } from '../types';

interface GreetingCardProps {
  onBack: () => void;
}

const GreetingCard: React.FC<GreetingCardProps> = ({ onBack }) => {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<SavedOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [showContent, setShowContent] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchOrder = async () => {
      try {
        const response = await fetch(`/api/orders/${orderId}`);
        if (!response.ok) {
          throw new Error('订单不存在');
        }
        const data: SavedOrder = await response.json();
        setOrder(data);
      } catch (error) {
        console.error('Failed to fetch order:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchOrder();
  }, [orderId]);

  useEffect(() => {
    if (order) {
      const startTime = Date.now();
      const duration = 3000;
      
      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        setScrollProgress(progress);
        
        if (progress >= 1) {
          setTimeout(() => setShowContent(true), 300);
        } else {
          requestAnimationFrame(animate);
        }
      };
      animate();
    }
  }, [order]);

  const handleDownload = async () => {
    if (!cardRef.current || isDownloading) return;
    setIsDownloading(true);
    
    try {
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: '#f5e6d0',
        scale: 2,
      });
      
      const link = document.createElement('a');
      link.download = `糕点贺卡_${orderId}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (error) {
      console.error('下载失败:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleShare = (platform: string) => {
    const shareText = `${order?.recipientName}，祝您福寿安康！这是我为您定制的玉露糕坊糕点贺卡：`;
    const url = window.location.href;
    
    let shareUrl = '';
    switch (platform) {
      case 'weibo':
        shareUrl = `https://service.weibo.com/share/share.php?title=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}`;
        break;
      case 'qq':
        shareUrl = `https://connect.qq.com/widget/shareqq/index.html?title=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}&desc=${encodeURIComponent('玉露糕坊定制糕点贺卡')}`;
        break;
      case 'copy':
        navigator.clipboard.writeText(url).then(() => {
          alert('链接已复制到剪贴板！');
        });
        return;
    }
    
    if (shareUrl) {
      window.open(shareUrl, '_blank', 'width=600,height=400');
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>加载中...</div>
      </div>
    );
  }

  if (!order) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>订单不存在</div>
        <button className="btn-ancient" onClick={onBack} style={{ marginTop: '20px' }}>
          返回首页
        </button>
      </div>
    );
  }

  const fillings = JSON.parse(order.fillings);
  const mold = JSON.parse(order.mold);
  const fillingNames = fillings.map((f: { name: string }) => f.name).join('、');

  return (
    <div style={styles.container} className="page-transition">
      <div 
        ref={cardRef}
        style={styles.scrollContainer}
      >
        <div style={{
          ...styles.scrollLeft,
          width: `${(1 - scrollProgress) * 50}%`,
        }} />
        <div style={{
          ...styles.scrollRight,
          width: `${(1 - scrollProgress) * 50}%`,
        }} />
        
        <div style={styles.scrollContent}>
          <div style={styles.patternBorder} />
          
          <div style={{
            ...styles.cardInner,
            opacity: showContent ? 1 : 0,
            transition: 'opacity 0.5s ease',
          }}>
            <h1 style={styles.cardTitle}>玉露糕坊</h1>
            <div style={styles.decoration} />
            
            <div style={styles.pastryDisplay}>
              {order.drawingData ? (
                <img 
                  src={order.drawingData} 
                  alt="定制糕点" 
                  style={styles.pastryImage}
                />
              ) : (
                <div style={styles.pastryPlaceholder}>糕点图</div>
              )}
            </div>

            <div style={styles.greetingSection}>
              <p style={styles.recipient}>{order.recipientName} 亲启</p>
              <p style={styles.blessing}>{order.blessing}</p>
            </div>

            <div style={styles.details}>
              <p style={styles.detail}>馅料：{fillingNames}</p>
              <p style={styles.detail}>模具：{mold.name}</p>
            </div>

            <div style={styles.orderIdSection}>
              <p style={styles.orderId}>订单编号：{order.orderId}</p>
              <p style={styles.date}>
                {new Date(order.createdAt).toLocaleDateString('zh-CN')}
              </p>
            </div>
            
            <div style={styles.seal}>
              <span style={styles.sealText}>玉露糕坊</span>
            </div>
          </div>
          
          <div style={styles.patternBorder} />
        </div>
      </div>

      {showContent && (
        <div style={styles.actions}>
          <h3 style={styles.actionTitle}>分享贺卡</h3>
          <div style={styles.shareButtons}>
            <button className="btn-ancient" onClick={handleDownload} disabled={isDownloading} style={styles.actionBtn}>
              {isDownloading ? '下载中...' : '下载图片'}
            </button>
            <button className="btn-ancient" onClick={() => handleShare('weibo')} style={styles.actionBtn}>
              微博
            </button>
            <button className="btn-ancient" onClick={() => handleShare('qq')} style={styles.actionBtn}>
              QQ
            </button>
            <button className="btn-ancient" onClick={() => handleShare('copy')} style={styles.actionBtn}>
              复制链接
            </button>
          </div>
          <button className="btn-ancient" onClick={onBack} style={styles.backBtn}>
            返回首页
          </button>
        </div>
      )}
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
  loading: {
    fontSize: '24px',
    color: '#c0392b',
    marginTop: '100px',
  },
  scrollContainer: {
    position: 'relative',
    width: '100%',
    maxWidth: '600px',
    minHeight: '700px',
    marginBottom: '30px',
    overflow: 'hidden',
  },
  scrollLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    background: 'linear-gradient(90deg, #8b4513, #d2691e)',
    zIndex: 10,
    transition: 'none',
    boxShadow: '5px 0 15px rgba(0,0,0,0.3)',
  },
  scrollRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    height: '100%',
    background: 'linear-gradient(270deg, #8b4513, #d2691e)',
    zIndex: 10,
    transition: 'none',
    boxShadow: '-5px 0 15px rgba(0,0,0,0.3)',
  },
  scrollContent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'linear-gradient(180deg, #fff8dc 0%, #f5e6d0 50%, #fff8dc 100%)',
    padding: '40px 30px',
    borderRadius: '8px',
    border: '3px solid #d4ac0d',
  },
  patternBorder: {
    height: '20px',
    background: `repeating-linear-gradient(
      45deg,
      transparent,
      transparent 10px,
      rgba(212, 172, 13, 0.2) 10px,
      rgba(212, 172, 13, 0.2) 20px
    )`,
    marginBottom: '20px',
    borderRadius: '4px',
  },
  cardInner: {
    textAlign: 'center',
    padding: '0 20px',
  },
  cardTitle: {
    fontSize: '48px',
    color: '#c0392b',
    fontFamily: "'Ma Shan Zheng', cursive",
    marginBottom: '10px',
    letterSpacing: '8px',
  },
  decoration: {
    width: '100px',
    height: '3px',
    background: 'linear-gradient(90deg, transparent, #d4ac0d, transparent)',
    margin: '0 auto 30px',
  },
  pastryDisplay: {
    marginBottom: '30px',
  },
  pastryImage: {
    width: '180px',
    height: '180px',
    borderRadius: '12px',
    objectFit: 'cover',
    border: '4px solid #d4ac0d',
    boxShadow: '0 8px 25px rgba(0,0,0,0.2)',
  },
  pastryPlaceholder: {
    width: '180px',
    height: '180px',
    margin: '0 auto',
    borderRadius: '12px',
    backgroundColor: '#f0e0d0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#999',
    border: '4px dashed #d4ac0d',
  },
  greetingSection: {
    marginBottom: '30px',
    padding: '20px',
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderRadius: '12px',
    borderLeft: '4px solid #c0392b',
    borderRight: '4px solid #c0392b',
  },
  recipient: {
    fontSize: '24px',
    color: '#333',
    fontFamily: "'Ma Shan Zheng', cursive",
    marginBottom: '15px',
  },
  blessing: {
    fontSize: '20px',
    color: '#555',
    lineHeight: '1.8',
    fontFamily: "'Ma Shan Zheng', cursive",
  },
  details: {
    marginBottom: '20px',
  },
  detail: {
    fontSize: '16px',
    color: '#666',
    marginBottom: '5px',
  },
  orderIdSection: {
    marginBottom: '20px',
    paddingTop: '15px',
    borderTop: '1px dashed #d4ac0d',
  },
  orderId: {
    fontSize: '14px',
    color: '#888',
    marginBottom: '5px',
  },
  date: {
    fontSize: '14px',
    color: '#888',
  },
  seal: {
    display: 'inline-block',
    padding: '10px 20px',
    backgroundColor: '#c0392b',
    color: '#fff',
    transform: 'rotate(-5deg)',
    borderRadius: '4px',
    opacity: 0.8,
  },
  sealText: {
    fontSize: '16px',
    fontFamily: "'Ma Shan Zheng', cursive",
    letterSpacing: '2px',
  },
  actions: {
    width: '100%',
    maxWidth: '600px',
    textAlign: 'center',
  },
  actionTitle: {
    fontSize: '24px',
    color: '#c0392b',
    fontFamily: "'Ma Shan Zheng', cursive",
    marginBottom: '20px',
  },
  shareButtons: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginBottom: '20px',
  },
  actionBtn: {
    padding: '10px 20px',
    fontSize: '16px',
  },
  backBtn: {
    padding: '12px 30px',
    fontSize: '18px',
  },
};

export default GreetingCard;
