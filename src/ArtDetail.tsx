import React, { useState, useEffect, useRef } from 'react'
import type { Artwork, Comment } from './types'
import { getComments, addComment, updateArtwork } from './db'

interface ArtDetailProps {
  artwork: Artwork
  onBack: () => void
}

const ArtDetail: React.FC<ArtDetailProps> = ({ artwork, onBack }) => {
  const [currentArtwork, setCurrentArtwork] = useState(artwork)
  const [comments, setComments] = useState<Comment[]>([])
  const [newComment, setNewComment] = useState('')
  const [showParticles, setShowParticles] = useState(false)
  const [particles, setParticles] = useState<Array<{ id: number; angle: number }>>([])
  const commentsEndRef = useRef<HTMLDivElement>(null)
  const particleIdRef = useRef(0)

  useEffect(() => {
    loadComments()
  }, [artwork.id])

  const loadComments = async () => {
    const items = await getComments(artwork.id)
    setComments(items)
  }

  useEffect(() => {
    if (commentsEndRef.current) {
      commentsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [comments.length])

  const handleLike = async () => {
    const updated = {
      ...currentArtwork,
      liked: !currentArtwork.liked,
      likes: currentArtwork.liked ? currentArtwork.likes - 1 : currentArtwork.likes + 1,
    }
    setCurrentArtwork(updated)
    await updateArtwork(updated)

    if (!currentArtwork.liked) {
      setShowParticles(true)
      const newParticles = Array.from({ length: 12 }, () => ({
        id: particleIdRef.current++,
        angle: Math.random() * Math.PI * 2,
      }))
      setParticles(newParticles)
      setTimeout(() => {
        setShowParticles(false)
        setParticles([])
      }, 500)
    }
  }

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newComment.trim()) return
    const comment: Omit<Comment, 'id'> = {
      artworkId: artwork.id,
      author: '访客用户',
      content: newComment.trim(),
      createdAt: Date.now(),
    }
    await addComment(comment)
    setNewComment('')
    loadComments()
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
  }

  const getInitial = (name: string) => {
    return name.charAt(0).toUpperCase()
  }

  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(245, 240, 232, 0.95)',
    backdropFilter: 'blur(8px)',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
  }

  return (
    <div style={containerStyle}>
      <div style={{ padding: 24, maxWidth: 900, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <button onClick={onBack} style={styles.backBtn}>← 返回画廊</button>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#5a4a3a', margin: 0 }}>
            {currentArtwork.name}
          </h1>
          <div style={{ width: 100 }} />
        </div>

        <div style={styles.imageContainer}>
          <img
            src={currentArtwork.data}
            alt={currentArtwork.name}
            style={styles.image}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 24, marginTop: 24 }}>
          <div style={{ position: 'relative' }}>
            <button
              onClick={handleLike}
              style={{
                ...styles.likeBtn,
                backgroundColor: currentArtwork.liked ? '#e74c3c' : 'transparent',
                border: `2px solid ${currentArtwork.liked ? '#e74c3c' : '#d4c9b0'}`,
              }}
            >
              <span style={{ fontSize: 24, color: currentArtwork.liked ? '#fff' : '#5a4a3a' }}>
                {currentArtwork.liked ? '❤' : '♡'}
              </span>
            </button>
            {showParticles && (
              <>
                {particles.map((p) => (
                <div
                  key={p.id}
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    width: 8,
                    height: 8,
                    backgroundColor: '#e74c3c',
                    borderRadius: '50%',
                    pointerEvents: 'none',
                    animation: `particle-${p.id} 0.5s ease-out forwards`,
                  }}
                />
              ))}
                <style>
                  {particles.map((p) => `
                    @keyframes particle-${p.id} {
                      0% {
                        transform: translate(-50%, -50%) scale(1);
                        opacity: 1;
                      }
                      100% {
                        transform: translate(
                          calc(-50% + ${Math.cos(p.angle) * 60}px),
                          calc(-50% + ${Math.sin(p.angle) * 60}px)
                        ) scale(0);
                        opacity: 0;
                      }
                    }
                  `).join('')}
                </style>
              </>
            )}
          </div>
          <span style={{ fontSize: 18, fontWeight: 600, color: '#5a4a3a' }}>
            {currentArtwork.likes} 个赞
          </span>
          <span style={{ fontSize: 14, color: '#8b7355' }}>
            by {currentArtwork.author}
          </span>
        </div>

        <div style={styles.commentsSection}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#5a4a3a', marginBottom: 16 }}>
            评论 ({comments.length})
          </h3>

          <form onSubmit={handleAddComment} style={styles.commentForm}>
            <input
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="写下你的评论..."
              style={styles.commentInput}
            />
            <button type="submit" style={styles.submitBtn}>发送</button>
          </form>

          <div style={styles.commentsList}>
            {comments.length === 0 ? (
              <p style={{ color: '#8b7355', textAlign: 'center', padding: 20 }}>
                暂无评论，快来抢沙发！
              </p>
            ) : (
              comments.map((comment, index) => (
                <div
                  key={comment.id}
                  style={{
                    ...styles.commentItem,
                    animationDelay: `${index * 0.05}s`,
                  }}
                >
                  <div style={styles.avatar}>
                    <span style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>
                      {getInitial(comment.author)}
                    </span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontWeight: 600, color: '#5a4a3a', fontSize: 14 }}>
                        {comment.author}
                      </span>
                      <span style={{ fontSize: 12, color: '#8b7355' }}>
                        {formatTime(comment.createdAt)}
                      </span>
                    </div>
                    <p style={{ margin: '4px 0 0 0', color: '#5a4a3a', fontSize: 14 }}>
                      {comment.content}
                    </p>
                  </div>
                </div>
              ))
            )}
            <div ref={commentsEndRef} />
          </div>
        </div>
      </div>

      <style>
        {`
          @keyframes commentFadeIn {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}
      </style>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  backBtn: {
    padding: '10px 20px',
    backgroundColor: '#fff',
    border: '1px solid #d4c9b0',
    borderRadius: 8,
    color: '#5a4a3a',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  imageContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  },
  image: {
    maxWidth: '90%',
    maxHeight: '70vh',
    objectFit: 'contain',
    borderRadius: 8,
    imageRendering: 'pixelated',
  },
  likeBtn: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  commentsSection: {
    marginTop: 32,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  },
  commentForm: {
    display: 'flex',
    gap: 12,
    marginBottom: 24,
  },
  commentInput: {
    flex: 1,
    padding: '12px 16px',
    border: '1px solid #d4c9b0',
    borderRadius: 8,
    fontSize: 14,
    outline: 'none',
    backgroundColor: '#faf7f2',
    color: '#5a4a3a',
  },
  submitBtn: {
    padding: '12px 24px',
    backgroundColor: '#5a4a3a',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  commentsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  commentItem: {
    display: 'flex',
    gap: 12,
    animation: 'commentFadeIn 0.3s ease-out',
    animationFillMode: 'both',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    backgroundColor: '#d4c9b0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
}

export default ArtDetail
