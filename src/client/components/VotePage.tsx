import React, { useState, useEffect, useMemo } from 'react';
import { Activity, Option } from '../../shared/types';

interface VotePageProps {
  activity: Activity;
  activityId: string;
  userId: string;
}

const VotePage: React.FC<VotePageProps> = ({ activity, activityId, userId }) => {
  const [voting, setVoting] = useState(false);
  const [animatingCard, setAnimatingCard] = useState<string | null>(null);

  const votedOptions = useMemo(() => {
    return activity.votedUsers[userId] || [];
  }, [activity.votedUsers, userId]);

  const handleVote = async (optionId: string) => {
    if (activity.ended || voting) return;
    if (votedOptions.includes(optionId)) return;
    if (votedOptions.length >= 3) {
      alert('每人最多只能投3票哦！');
      return;
    }

    setVoting(true);
    setAnimatingCard(optionId);

    try {
      const response = await fetch(`/api/activities/${activityId}/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          optionId,
          userId
        })
      });

      if (!response.ok) {
        const error = await response.json();
        alert(error.error || '投票失败');
      }
    } catch (error) {
      console.error('Vote failed:', error);
      alert('投票失败，请重试');
    } finally {
      setTimeout(() => {
        setVoting(false);
        setAnimatingCard(null);
      }, 300);
    }
  };

  const totalVotes = activity.options.reduce((sum, opt) => sum + opt.votes, 0);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>{activity.name}</h1>
        {activity.description && (
          <p style={styles.description}>{activity.description}</p>
        )}
        <div style={styles.meta}>
          <span style={styles.metaItem}>📍 {activity.location}</span>
          <span style={styles.metaItem}>🕐 {new Date(activity.time).toLocaleString('zh-CN')}</span>
        </div>
        <div style={styles.voteInfo}>
          <span style={styles.voteCount}>
            已投 <strong style={{ color: '#F5A623' }}>{votedOptions.length}</strong> / 3 票
          </span>
          <span style={styles.totalVotes}>总票数：{totalVotes}</span>
        </div>
        {activity.ended && (
          <div style={styles.endedBanner}>
            ⏹️ 投票已结束
          </div>
        )}
      </div>

      <div style={styles.grid}>
        {activity.options.map((option, index) => {
          const isVoted = votedOptions.includes(option.id);
          const isAnimating = animatingCard === option.id;
          const isDisabled = activity.ended || (votedOptions.length >= 3 && !isVoted);

          return (
            <div
              key={option.id}
              onClick={() => handleVote(option.id)}
              style={{
                ...styles.card,
                border: isVoted ? '3px solid #F5A623' : '2px solid transparent',
                transform: isAnimating ? 'scale(1.05)' : 'scale(1)',
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                opacity: isDisabled && !isVoted ? 0.6 : 1,
                animation: `slideIn 0.5s ease forwards`,
                animationDelay: `${index * 0.1}s`
              }}
            >
              {isVoted && (
                <div style={styles.heartBadge}>
                  ❤️
                </div>
              )}
              
              {option.imageUrl ? (
                <img
                  src={option.imageUrl}
                  alt={option.name}
                  style={styles.image}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <div style={styles.placeholderImage}>
                  🖼️
                </div>
              )}
              
              <div style={styles.cardContent}>
                <div style={styles.cardHeader}>
                  <h3 style={styles.optionName}>{option.name}</h3>
                  <div style={{
                    ...styles.voteBadge,
                    backgroundColor: isVoted ? '#F5A623' : '#4A90D9'
                  }}>
                    {option.votes} 票
                  </div>
                </div>
                <p style={styles.optionDescription}>{option.description}</p>
                
                {!activity.ended && (
                  <button
                    style={{
                      ...styles.voteButton,
                      backgroundColor: isVoted ? '#F5A623' : '#4A90D9',
                      opacity: isDisabled && !isVoted ? 0.5 : 1
                    }}
                    disabled={isDisabled && !isVoted}
                  >
                    {isVoted ? '❤️ 已投票' : '👍 投票'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(20px);
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

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px'
  },
  header: {
    textAlign: 'center',
    marginBottom: '40px',
    backgroundColor: 'white',
    padding: '32px',
    borderRadius: '20px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)'
  },
  title: {
    fontSize: '36px',
    color: '#4A90D9',
    marginBottom: '12px'
  },
  description: {
    fontSize: '16px',
    color: '#666',
    marginBottom: '20px'
  },
  meta: {
    display: 'flex',
    justifyContent: 'center',
    gap: '24px',
    flexWrap: 'wrap',
    marginBottom: '20px'
  },
  metaItem: {
    fontSize: '14px',
    color: '#888'
  },
  voteInfo: {
    display: 'flex',
    justifyContent: 'center',
    gap: '32px',
    flexWrap: 'wrap'
  },
  voteCount: {
    fontSize: '16px',
    color: '#333'
  },
  totalVotes: {
    fontSize: '16px',
    color: '#888'
  },
  endedBanner: {
    marginTop: '16px',
    padding: '12px 24px',
    backgroundColor: '#fef3c7',
    color: '#92400e',
    borderRadius: '10px',
    fontSize: '16px',
    fontWeight: '600',
    display: 'inline-block'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '24px'
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '16px',
    overflow: 'hidden',
    boxShadow: '0 4px 15px rgba(0, 0, 0, 0.08)',
    transition: 'all 0.3s ease',
    position: 'relative',
    opacity: 0
  },
  heartBadge: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    fontSize: '24px',
    zIndex: 10,
    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))'
  },
  image: {
    width: '100%',
    height: '180px',
    objectFit: 'cover',
    display: 'block'
  },
  placeholderImage: {
    width: '100%',
    height: '180px',
    backgroundColor: '#f0f0f0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '48px'
  },
  cardContent: {
    padding: '20px'
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px'
  },
  optionName: {
    fontSize: '18px',
    color: '#333',
    fontWeight: '600'
  },
  voteBadge: {
    padding: '4px 12px',
    borderRadius: '20px',
    color: 'white',
    fontSize: '13px',
    fontWeight: '600'
  },
  optionDescription: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '16px',
    lineHeight: '1.5'
  },
  voteButton: {
    width: '100%',
    padding: '12px',
    border: 'none',
    borderRadius: '10px',
    color: 'white',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s ease'
  }
};

export default VotePage;
