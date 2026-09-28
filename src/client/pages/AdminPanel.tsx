import { useEffect, useState } from 'react';
import { Check, X, Clock, Users, Music, Calendar } from 'lucide-react';
import { Band } from '../types';
import { bandsApi } from '../services/api';
import { useStore } from '../store/useStore';
import { formatDateTime } from '../utils/time';
import './AdminPanel.css';

type FilterStatus = 'all' | 'pending' | 'approved' | 'rejected';

export default function AdminPanel() {
  const { bands, setBands, updateBandStatus, addNotification } = useStore();
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('pending');
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  useEffect(() => {
    const fetchBands = async () => {
      try {
        const data = await bandsApi.getBands();
        setBands(data);
      } catch (error: any) {
        addNotification({ message: error.message || '加载失败', type: 'error' });
      } finally {
        setLoading(false);
      }
    };

    fetchBands();
  }, [setBands, addNotification]);

  const handleReview = async (id: string, status: 'approved' | 'rejected') => {
    setReviewingId(id);
    try {
      await bandsApi.reviewBand(id, status);
      updateBandStatus(id, status);
      addNotification({
        message: status === 'approved' ? '已通过审核' : '已拒绝申请',
        type: 'success'
      });
    } catch (error: any) {
      addNotification({ message: error.message || '操作失败', type: 'error' });
    } finally {
      setReviewingId(null);
    }
  };

  const filteredBands = bands.filter(band => {
    if (filterStatus === 'all') return true;
    return band.status === filterStatus;
  });

  const statusStats = {
    all: bands.length,
    pending: bands.filter(b => b.status === 'pending').length,
    approved: bands.filter(b => b.status === 'approved').length,
    rejected: bands.filter(b => b.status === 'rejected').length
  };

  if (loading) {
    return (
      <div className="admin-page">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1 className="page-title">乐队审核面板</h1>
        <p className="page-subtitle">管理乐队报名申请</p>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-icon all">
            <Music size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{statusStats.all}</span>
            <span className="stat-label">总申请</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon pending">
            <Clock size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{statusStats.pending}</span>
            <span className="stat-label">待审核</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon approved">
            <Check size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{statusStats.approved}</span>
            <span className="stat-label">已通过</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon rejected">
            <X size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{statusStats.rejected}</span>
            <span className="stat-label">已拒绝</span>
          </div>
        </div>
      </div>

      <div className="filter-tabs">
        {(['all', 'pending', 'approved', 'rejected'] as FilterStatus[]).map(status => (
          <button
            key={status}
            className={`filter-tab ${filterStatus === status ? 'active' : ''}`}
            onClick={() => setFilterStatus(status)}
          >
            {status === 'all' && '全部'}
            {status === 'pending' && '待审核'}
            {status === 'approved' && '已通过'}
            {status === 'rejected' && '已拒绝'}
            <span className="tab-count">{statusStats[status]}</span>
          </button>
        ))}
      </div>

      <div className="bands-list">
        {filteredBands.length === 0 ? (
          <div className="empty-state">
            <Music size={48} />
            <p>暂无{filterStatus === 'all' ? '' : filterStatus === 'pending' ? '待审核的' : filterStatus === 'approved' ? '已通过的' : '已拒绝的'}乐队申请</p>
          </div>
        ) : (
          filteredBands.map((band, index) => (
            <BandCard
              key={band.id}
              band={band}
              index={index}
              onReview={handleReview}
              isReviewing={reviewingId === band.id}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface BandCardProps {
  band: Band;
  index: number;
  onReview: (id: string, status: 'approved' | 'rejected') => void;
  isReviewing: boolean;
}

function BandCard({ band, index, onReview, isReviewing }: BandCardProps) {
  const statusConfig = {
    pending: { label: '待审核', class: 'status-pending' },
    approved: { label: '已通过', class: 'status-approved' },
    rejected: { label: '已拒绝', class: 'status-rejected' }
  };

  const status = statusConfig[band.status];

  return (
    <div
      className="band-card fade-in"
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      <div className="card-header">
        <div className="band-name-row">
          <h3 className="band-name">{band.name}</h3>
          <span className={`status-badge ${status.class}`}>
            {status.label}
          </span>
        </div>
        <div className="band-meta">
          <span><Calendar size={14} /> {formatDateTime(band.submittedAt)}</span>
        </div>
      </div>

      <p className="band-description">{band.description}</p>

      <div className="card-footer">
        <div className="band-tags">
          {band.genres.map(genre => (
            <span key={genre} className="genre-tag">{genre}</span>
          ))}
        </div>
        <div className="band-info">
          <span><Users size={14} /> {band.memberCount}人</span>
        </div>
      </div>

      {band.status === 'pending' && (
        <div className="card-actions">
          <button
            className="action-btn approve"
            onClick={() => onReview(band.id, 'approved')}
            disabled={isReviewing}
          >
            <Check size={16} />
            通过
          </button>
          <button
            className="action-btn reject"
            onClick={() => onReview(band.id, 'rejected')}
            disabled={isReviewing}
          >
            <X size={16} />
            拒绝
          </button>
        </div>
      )}
    </div>
  );
}
