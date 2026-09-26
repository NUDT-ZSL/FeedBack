import { useEffect, useState, useRef } from 'react';
import { Heart, MessageCircle, Send, Filter, Smile, Meh, Zap, AlertCircle, Moon } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Diary, Mood, MOOD_LABELS, MOOD_COLORS, SPECIES_LABELS, Pet, Species } from '../types';

const moodIcons: Record<Mood, React.ReactNode> = {
  happy: <Smile size={16} />,
  normal: <Meh size={16} />,
  playful: <Zap size={16} />,
  sick: <AlertCircle size={16} />,
  sleepy: <Moon size={16} />
};

interface Particle {
  id: number;
  x: number;
  y: number;
  angle: number;
}

function Community() {
  const { state, fetchCommunityDiaries, likeDiary, addComment, fetchPets } = useApp();
  const [breedFilter, setBreedFilter] = useState<string>('all');
  const [moodFilter, setMoodFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [commentInputs, setCommentInputs] = useState<Record<string, { text: string; username: string; showSuggestions: boolean; suggestions: string[] }>>({});

  useEffect(() => {
    fetchPets();
    fetchCommunityDiaries();
  }, [fetchPets, fetchCommunityDiaries]);

  useEffect(() => {
    fetchCommunityDiaries({ breed: breedFilter, mood: moodFilter });
  }, [breedFilter, moodFilter, fetchCommunityDiaries]);

  const allSpecies = ['all', ...Object.keys(SPECIES_LABELS)];
  const allMoods = ['all', ...Object.keys(MOOD_LABELS)];

  const toggleComments = (diaryId: string) => {
    setExpandedComments(prev => {
      const next = new Set(prev);
      if (next.has(diaryId)) {
        next.delete(diaryId);
      } else {
        next.add(diaryId);
      }
      return next;
    });
  };

  const handleCommentInput = (diaryId: string, text: string) => {
    setCommentInputs(prev => ({
      ...prev,
      [diaryId]: {
        ...prev[diaryId],
        text,
        showSuggestions: text.includes('@'),
        suggestions: text.includes('@') 
          ? ['邻居小王', '猫奴小李', '兔妈', '金毛爸爸', '铲屎官小张']
              .filter(name => name.toLowerCase().includes(text.slice(text.lastIndexOf('@') + 1).toLowerCase()))
          : []
      }
    }));
  };

  const insertMention = (diaryId: string, username: string) => {
    const current = commentInputs[diaryId]?.text || '';
    const atIndex = current.lastIndexOf('@');
    const newText = current.slice(0, atIndex) + '@' + username + ' ';
    setCommentInputs(prev => ({
      ...prev,
      [diaryId]: {
        ...prev[diaryId],
        text: newText,
        showSuggestions: false
      }
    }));
  };

  const handleSubmitComment = async (diaryId: string) => {
    const input = commentInputs[diaryId];
    if (!input?.text.trim()) return;

    const username = input.username || '匿名用户';
    const result = await addComment(diaryId, username, input.text);
    
    if (result) {
      setCommentInputs(prev => ({
        ...prev,
        [diaryId]: { ...prev[diaryId], text: '', showSuggestions: false }
      }));
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>社区广场</h2>
        <button 
          style={styles.filterButton}
          className="button-hover"
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter size={18} style={{ marginRight: 6 }} />
          筛选
        </button>
      </div>

      {showFilters && (
        <div style={styles.filtersPanel} className="animate-slide-up">
          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>宠物品种</label>
            <div style={styles.filterOptions}>
              {allSpecies.map(species => (
                <button
                  key={species}
                  style={{
                    ...styles.filterOption,
                    backgroundColor: breedFilter === species ? '#E67E22' : '#F5E6D3',
                    color: breedFilter === species ? 'white' : '#6B4226'
                  }}
                  onClick={() => setBreedFilter(species)}
                >
                  {species === 'all' ? '全部' : SPECIES_LABELS[species as Species]}
                </button>
              ))}
            </div>
          </div>
          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>心情标签</label>
            <div style={styles.filterOptions}>
              {allMoods.map(mood => (
                <button
                  key={mood}
                  style={{
                    ...styles.filterOption,
                    backgroundColor: moodFilter === mood 
                      ? (mood === 'all' ? '#E67E22' : MOOD_COLORS[mood as Mood])
                      : '#F5E6D3',
                    color: moodFilter === mood ? 'white' : '#6B4226'
                  }}
                  onClick={() => setMoodFilter(mood)}
                >
                  {mood === 'all' ? '全部' : (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {moodIcons[mood as Mood]}
                      {MOOD_LABELS[mood as Mood]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={styles.diaryList}>
        {state.communityLoading && state.communityDiaries.length === 0 ? (
          <div style={styles.loading}>加载中...</div>
        ) : state.communityDiaries.length === 0 ? (
          <div style={styles.empty}>
            <p>暂无日记</p>
          </div>
        ) : (
          state.communityDiaries.map((diary, index) => (
            <CommunityCard
              key={diary.id}
              diary={diary}
              index={index}
              pets={state.pets}
              onLike={likeDiary}
              expandedComments={expandedComments}
              toggleComments={toggleComments}
              commentInputs={commentInputs}
              handleCommentInput={handleCommentInput}
              handleSubmitComment={handleSubmitComment}
              insertMention={insertMention}
            />
          ))
        )}
      </div>
    </div>
  );
}

function CommunityCard({
  diary,
  index,
  pets,
  onLike,
  expandedComments,
  toggleComments,
  commentInputs,
  handleCommentInput,
  handleSubmitComment,
  insertMention
}: {
  diary: Diary;
  index: number;
  pets: Pet[];
  onLike: (id: string) => void;
  expandedComments: Set<string>;
  toggleComments: (id: string) => void;
  commentInputs: Record<string, { text: string; username: string; showSuggestions: boolean; suggestions: string[] }>;
  handleCommentInput: (id: string, text: string) => void;
  handleSubmitComment: (id: string) => void;
  insertMention: (id: string, username: string) => void;
}) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const likeButtonRef = useRef<HTMLButtonElement>(null);
  const pet = pets.find(p => p.id === diary.petId);
  const isExpanded = expandedComments.has(diary.id);
  const input = commentInputs[diary.id];

  const handleLike = () => {
    if (isAnimating) return;
    
    setIsAnimating(true);
    onLike(diary.id);

    if (likeButtonRef.current) {
      const rect = likeButtonRef.current.getBoundingClientRect();
      const newParticles: Particle[] = [];
      for (let i = 0; i < 6; i++) {
        newParticles.push({
          id: Date.now() + i,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          angle: (i * 60) * (Math.PI / 180)
        });
      }
      setParticles(newParticles);
      setTimeout(() => setParticles([]), 300);
    }

    setTimeout(() => setIsAnimating(false), 300);
  };

  return (
    <div
      style={{
        ...styles.card,
        animationDelay: `${index * 0.1}s`
      }}
      className="animate-slide-up card-hover"
    >
      {particles.map(p => (
        <div
          key={p.id}
          className="particle"
          style={{
            left: p.x,
            top: p.y,
            '--tx': `${Math.cos(p.angle) * 40}px`,
            '--ty': `${Math.sin(p.angle) * 40}px`
          } as React.CSSProperties}
        />
      ))}

      <div style={styles.cardHeader}>
        <div style={styles.petInfo}>
          {pet && (
            <img src={pet.avatar} alt={pet.name} style={styles.avatar} />
          )}
          <div>
            <span style={styles.petName}>{diary.petName}</span>
            {pet && (
              <span style={styles.breed}>{pet.breed}</span>
            )}
          </div>
        </div>
        <span 
          style={{
            ...styles.moodBadge,
            backgroundColor: MOOD_COLORS[diary.mood] + '20',
            color: MOOD_COLORS[diary.mood]
          }}
        >
          {moodIcons[diary.mood]}
          {MOOD_LABELS[diary.mood]}
        </span>
      </div>

      {diary.images.length > 0 && (
        <div style={styles.cardImages}>
          {diary.images.map((img, i) => (
            <img 
              key={i} 
              src={img} 
              alt="" 
              style={{
                ...styles.cardImage,
                width: diary.images.length === 1 ? '100%' : diary.images.length === 2 ? 'calc(50% - 4px)' : 'calc(33.33% - 6px)'
              }}
              loading="lazy"
            />
          ))}
        </div>
      )}

      <p style={styles.cardContent}>{diary.content}</p>

      <div style={styles.cardFooter}>
        <span style={styles.date}>
          {new Date(diary.createdAt).toLocaleString('zh-CN')}
        </span>
        <div style={styles.actions}>
          <button
            ref={likeButtonRef}
            style={{
              ...styles.actionButton,
              color: diary.liked ? '#E74C3C' : '#8D8D8D',
              transform: isAnimating ? 'scale(1.2)' : 'scale(1)'
            }}
            onClick={handleLike}
          >
            <Heart 
              size={20} 
              fill={diary.liked ? '#E74C3C' : 'none'}
              style={{ transition: 'all 0.3s ease' }}
            />
            <span style={styles.actionCount}>{diary.likes}</span>
          </button>
          <button
            style={{
              ...styles.actionButton,
              color: isExpanded ? '#E67E22' : '#8D8D8D'
            }}
            onClick={() => toggleComments(diary.id)}
          >
            <MessageCircle size={20} />
            <span style={styles.actionCount}>{diary.comments.length}</span>
          </button>
        </div>
      </div>

      {isExpanded && (
        <div style={styles.commentsSection} className="animate-fade-in">
          {diary.comments.length > 0 && (
            <div style={styles.commentsList}>
              {diary.comments.map((comment, idx) => (
                <div 
                  key={comment.id} 
                  style={styles.commentBubble}
                  className="animate-expand"
                >
                  <span style={styles.commentUser}>{comment.username}</span>
                  <p style={styles.commentText}>{comment.content}</p>
                </div>
              ))}
            </div>
          )}
          
          <div style={styles.commentInputContainer}>
            {input?.showSuggestions && input.suggestions.length > 0 && (
              <div style={styles.suggestions}>
                {input.suggestions.map(name => (
                  <button
                    key={name}
                    style={styles.suggestionItem}
                    onClick={() => insertMention(diary.id, name)}
                  >
                    @{name}
                  </button>
                ))}
              </div>
            )}
            <input
              type="text"
              placeholder="输入评论，@提及用户..."
              value={input?.text || ''}
              onChange={e => handleCommentInput(diary.id, e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmitComment(diary.id)}
              style={styles.commentInput}
              maxLength={100}
            />
            <button
              style={{
                ...styles.sendButton,
                opacity: !input?.text.trim() ? 0.5 : 1
              }}
              className="button-hover"
              onClick={() => handleSubmitComment(diary.id)}
              disabled={!input?.text.trim()}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    maxWidth: 700,
    margin: '0 auto'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24
  },
  title: {
    fontSize: 28,
    fontWeight: 600,
    color: '#3D2914',
    margin: 0
  },
  filterButton: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 20px',
    backgroundColor: '#6B4226',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    fontSize: 14,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    fontFamily: 'Georgia, serif'
  },
  filtersPanel: {
    backgroundColor: '#FFFCF7',
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
    boxShadow: '0 2px 12px rgba(107, 66, 38, 0.08)',
    opacity: 0
  },
  filterGroup: {
    marginBottom: 16
  },
  filterLabel: {
    display: 'block',
    fontSize: 14,
    fontWeight: 500,
    color: '#3D2914',
    marginBottom: 10
  },
  filterOptions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap'
  },
  filterOption: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    fontFamily: 'Georgia, serif',
    display: 'flex',
    alignItems: 'center',
    gap: 4
  },
  loading: {
    textAlign: 'center',
    padding: '60px 0',
    color: '#8D8D8D'
  },
  empty: {
    textAlign: 'center',
    padding: '80px 20px',
    color: '#8D8D8D',
    backgroundColor: '#FFFCF7',
    borderRadius: 20
  },
  diaryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20
  },
  card: {
    backgroundColor: '#FFFCF7',
    borderRadius: 20,
    padding: 24,
    boxShadow: '0 2px 12px rgba(107, 66, 38, 0.08)',
    transition: 'all 0.2s ease',
    position: 'relative',
    opacity: 0
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16
  },
  petInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 12
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    objectFit: 'cover'
  },
  petName: {
    display: 'block',
    fontSize: 16,
    fontWeight: 600,
    color: '#3D2914',
    marginBottom: 2
  },
  breed: {
    fontSize: 12,
    color: '#8D8D8D'
  },
  moodBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 12px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 500
  },
  cardImages: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 16
  },
  cardImage: {
    height: 200,
    borderRadius: 12,
    objectFit: 'cover',
    cursor: 'pointer',
    transition: 'transform 0.2s ease'
  },
  cardContent: {
    fontSize: 15,
    lineHeight: 1.7,
    color: '#3D2914',
    margin: '0 0 16px 0'
  },
  cardFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
    borderTop: '1px solid rgba(107, 66, 38, 0.08)'
  },
  date: {
    fontSize: 12,
    color: '#8D8D8D'
  },
  actions: {
    display: 'flex',
    gap: 20
  },
  actionButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: 4,
    borderRadius: 8,
    transition: 'all 0.2s ease'
  },
  actionCount: {
    fontSize: 14,
    fontWeight: 500
  },
  commentsSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTop: '1px solid rgba(107, 66, 38, 0.08)'
  },
  commentsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    marginBottom: 16
  },
  commentBubble: {
    backgroundColor: '#F5E6D3',
    borderRadius: '12px 12px 12px 4px',
    padding: '12px 16px',
    transform: 'scaleX(0)',
    opacity: 0
  },
  commentUser: {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#6B4226',
    marginBottom: 4
  },
  commentText: {
    fontSize: 14,
    color: '#3D2914',
    margin: 0,
    lineHeight: 1.5
  },
  commentInputContainer: {
    display: 'flex',
    gap: 8,
    position: 'relative'
  },
  commentInput: {
    flex: 1,
    padding: '12px 16px',
    border: '1px solid rgba(107, 66, 38, 0.2)',
    borderRadius: 20,
    fontSize: 14,
    backgroundColor: 'white',
    fontFamily: 'Georgia, serif'
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    backgroundColor: '#E67E22',
    color: 'white',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease'
  },
  suggestions: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    backgroundColor: 'white',
    borderRadius: 12,
    boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
    marginBottom: 8,
    overflow: 'hidden',
    zIndex: 10
  },
  suggestionItem: {
    display: 'block',
    width: '100%',
    padding: '10px 16px',
    border: 'none',
    backgroundColor: 'transparent',
    textAlign: 'left',
    cursor: 'pointer',
    fontSize: 14,
    color: '#3D2914',
    transition: 'background-color 0.15s ease',
    fontFamily: 'Georgia, serif'
  }
};

export default Community;
