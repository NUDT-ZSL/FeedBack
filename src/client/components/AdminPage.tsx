import React, { useState, useEffect } from 'react';
import { Activity } from '../../shared/types';

interface AdminPageProps {
  activity: Activity;
  activityId: string;
  getServerTime: () => number;
}

const AdminPage: React.FC<AdminPageProps> = ({ activity, activityId, getServerTime }) => {
  const [elapsedTime, setElapsedTime] = useState('00:00:00');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (activity.ended) return;

    const updateTimer = () => {
      const now = getServerTime();
      const elapsed = now - activity.createdAt;
      
      const hours = Math.floor(elapsed / 3600000);
      const minutes = Math.floor((elapsed % 3600000) / 60000);
      const seconds = Math.floor((elapsed % 60000) / 1000);
      
      setElapsedTime(
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      );
    };

    updateTimer();
    const timer = setInterval(updateTimer, 1000);

    return () => clearInterval(timer);
  }, [activity.createdAt, activity.ended, getServerTime]);

  const handleEndVoting = async () => {
    if (!confirm('确定要结束投票吗？结束后将无法继续投票。')) return;
    
    try {
      const response = await fetch(`/api/activities/${activityId}/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        alert('结束投票失败，请重试');
      }
    } catch (error) {
      console.error('Failed to end voting:', error);
      alert('结束投票失败，请重试');
    }
  };

  const handleExportJSON = () => {
    const sortedOptions = [...activity.options].sort((a, b) => b.votes - a.votes);
    
    const exportData = {
      activity: {
        id: activity.id,
        name: activity.name,
        description: activity.description,
        location: activity.location,
        time: activity.time,
        createdAt: new Date(activity.createdAt).toISOString(),
        ended: activity.ended,
        endedAt: activity.endedAt ? new Date(activity.endedAt).toISOString() : null,
        duration: activity.endedAt ? activity.endedAt - activity.createdAt : null
      },
      results: sortedOptions.map((opt, index) => ({
        rank: index + 1,
        name: opt.name,
        description: opt.description,
        imageUrl: opt.imageUrl,
        votes: opt.votes
      })),
      totalVotes: activity.options.reduce((sum, opt) => sum + opt.votes, 0),
      totalParticipants: Object.keys(activity.votedUsers).length,
      exportTime: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `投票结果_${activity.name}_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyShareLink = async () => {
    const shareLink = `${window.location.origin}/#/vote/${activityId}`;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(shareLink);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = shareLink;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      alert('复制失败，请手动复制链接');
    }
  };

  const sortedOptions = [...activity.options].sort((a, b) => b.votes - a.votes);
  const maxVotes = Math.max(...sortedOptions.map(opt => opt.votes), 1);
  const totalVotes = activity.options.reduce((sum, opt) => sum + opt.votes, 0);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerTop}>
          <div>
            <h1 style={styles.title}>{activity.name}</h1>
            <p style={styles.subtitle}>活动管理面板</p>
          </div>
          <div style={styles.timerContainer}>
            <div style={styles.timerLabel}>
              {activity.ended ? '投票已结束' : '投票进行中'}
            </div>
            <div style={styles.timer}>
              ⏱️ {activity.ended 
                ? `历时 ${formatDuration(activity.endedAt! - activity.createdAt)}`
                : elapsedTime
              }
            </div>
          </div>
        </div>
        
        <div style={styles.stats}>
          <div style={styles.statCard}>
            <span style={styles.statIcon}>👥</span>
            <div style={styles.statContent}>
              <div style={styles.statValue}>{Object.keys(activity.votedUsers).length}</div>
              <div style={styles.statLabel}>参与人数</div>
            </div>
          </div>
          <div style={styles.statCard}>
            <span style={styles.statIcon}>🗳️</span>
            <div style={styles.statContent}>
              <div style={styles.statValue}>{totalVotes}</div>
              <div style={styles.statLabel}>总票数</div>
            </div>
          </div>
          <div style={styles.statCard}>
            <span style={styles.statIcon}>🎯</span>
            <div style={styles.statContent}>
              <div style={styles.statValue}>{activity.options.length}</div>
              <div style={styles.statLabel}>候选项</div>
            </div>
          </div>
        </div>
        
        <div style={styles.actions}>
          <button
            onClick={copyShareLink}
            style={{
              ...styles.actionButton,
              backgroundColor: copied ? '#27ae60' : '#4A90D9'
            }}
          >
            {copied ? '✓ 已复制' : '🔗 复制分享链接'}
          </button>
          <button
            onClick={handleExportJSON}
            style={styles.exportButton}
          >
            📥 导出JSON
          </button>
          {!activity.ended && (
            <button
              onClick={handleEndVoting}
              style={styles.endButton}
            >
              ⏹️ 结束投票
            </button>
          )}
        </div>
      </div>

      <div style={styles.rankingsCard}>
        <h2 style={styles.rankingsTitle}>
          {activity.ended ? '🏆 最终排名' : '📊 实时排名'}
        </h2>
        
        <div style={styles.rankings}>
          {sortedOptions.map((option, index) => (
            <div key={option.id} style={styles.rankingItem}>
              <div style={styles.rankBadge}>
                {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
              </div>
              
              <div style={styles.rankingContent}>
                <div style={styles.rankingHeader}>
                  <span style={styles.optionName}>{option.name}</span>
                  <span style={styles.voteCount}>{option.votes} 票</span>
                </div>
                
                <div style={styles.progressContainer}>
                  <div
                    style={{
                      ...styles.progressBar,
                      width: `${(option.votes / maxVotes) * 100}%`,
                      background: `linear-gradient(90deg, #4A90D9 0%, #F5A623 100%)`
                    }}
                  />
                </div>
                
                {option.votes > 0 && (
                  <div style={styles.percentage}>
                    {totalVotes > 0 ? ((option.votes / totalVotes) * 100).toFixed(1) : 0}%
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {activity.ended && (
        <div style={styles.winnerCard}>
          <div style={styles.winnerIcon}>🎉</div>
          <h3 style={styles.winnerTitle}>
            获胜者：{sortedOptions[0]?.name || '暂无'}
          </h3>
          <p style={styles.winnerVotes}>
            获得 {sortedOptions[0]?.votes || 0} 票
            {totalVotes > 0 && ` (${((sortedOptions[0]?.votes || 0) / totalVotes * 100).toFixed(1)}%)`}
          </p>
        </div>
      )}
    </div>
  );
};

const formatDuration = (ms: number): string => {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '1000px',
    margin: '0 auto',
    padding: '20px'
  },
  header: {
    backgroundColor: 'white',
    borderRadius: '20px',
    padding: '32px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
    marginBottom: '24px'
  },
  headerTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '24px',
    flexWrap: 'wrap',
    gap: '16px'
  },
  title: {
    fontSize: '32px',
    color: '#4A90D9',
    marginBottom: '4px'
  },
  subtitle: {
    fontSize: '14px',
    color: '#888'
  },
  timerContainer: {
    textAlign: 'right'
  },
  timerLabel: {
    fontSize: '14px',
    color: '#F5A623',
    fontWeight: '600',
    marginBottom: '4px'
  },
  timer: {
    fontSize: '28px',
    fontFamily: 'monospace',
    fontWeight: '700',
    color: '#333',
    backgroundColor: '#f8fafc',
    padding: '8px 16px',
    borderRadius: '10px'
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '16px',
    marginBottom: '24px'
  },
  statCard: {
    backgroundColor: '#f8fafc',
    borderRadius: '12px',
    padding: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  statIcon: {
    fontSize: '32px'
  },
  statContent: {
    display: 'flex',
    flexDirection: 'column'
  },
  statValue: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#333'
  },
  statLabel: {
    fontSize: '12px',
    color: '#888'
  },
  actions: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap'
  },
  actionButton: {
    backgroundColor: '#4A90D9',
    color: 'white',
    border: 'none',
    padding: '12px 24px',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s ease'
  },
  exportButton: {
    backgroundColor: '#10b981',
    color: 'white',
    border: 'none',
    padding: '12px 24px',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s ease'
  },
  endButton: {
    backgroundColor: '#ef4444',
    color: 'white',
    border: 'none',
    padding: '12px 24px',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s ease'
  },
  rankingsCard: {
    backgroundColor: 'white',
    borderRadius: '20px',
    padding: '32px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
    marginBottom: '24px'
  },
  rankingsTitle: {
    fontSize: '24px',
    color: '#333',
    marginBottom: '24px'
  },
  rankings: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  rankingItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '16px'
  },
  rankBadge: {
    fontSize: '28px',
    minWidth: '48px',
    textAlign: 'center',
    fontWeight: '700'
  },
  rankingContent: {
    flex: 1,
    minWidth: 0
  },
  rankingHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  optionName: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#333'
  },
  voteCount: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#F5A623'
  },
  progressContainer: {
    height: '12px',
    backgroundColor: '#e2e8f0',
    borderRadius: '6px',
    overflow: 'hidden'
  },
  progressBar: {
    height: '100%',
    borderRadius: '6px',
    transition: 'width 0.5s ease'
  },
  percentage: {
    fontSize: '12px',
    color: '#888',
    marginTop: '4px',
    textAlign: 'right'
  },
  winnerCard: {
    backgroundColor: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
    borderRadius: '20px',
    padding: '32px',
    textAlign: 'center',
    boxShadow: '0 4px 20px rgba(245, 166, 35, 0.2)',
    border: '2px solid #F5A623'
  },
  winnerIcon: {
    fontSize: '48px',
    marginBottom: '12px'
  },
  winnerTitle: {
    fontSize: '24px',
    color: '#92400e',
    marginBottom: '8px'
  },
  winnerVotes: {
    fontSize: '16px',
    color: '#b45309'
  }
};

export default AdminPage;
