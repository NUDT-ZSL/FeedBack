import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Heart, MessageCircle, Send, MapPin, Clock } from 'lucide-react'
import { clsx } from 'clsx'
import { useStore, type Pet, type Item, type Comment } from '../store'
import { getAvatarColor } from '../App'

const EMOJIS = ['😊', '😍', '🥰', '😂', '🤣', '😘', '🐶', '🐱', '🐾', '❤️', '👍', '🎉', '💪', '🤗', '😢', '🙏']

export default function DetailPage() {
  const { type, id } = useParams<{ type: 'pet' | 'item'; id: string }>()
  const navigate = useNavigate()
  const { currentUser, pets, items, comments, applications, fetchPets, fetchItems, fetchComments, fetchApplications, submitApplication, addComment, toggleLike } = useStore()

  const [showApplyModal, setShowApplyModal] = useState(false)
  const [applyType, setApplyType] = useState<'borrow' | 'adopt'>('borrow')
  const [reason, setReason] = useState('')
  const [contact, setContact] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [showEmojis, setShowEmojis] = useState(false)

  useEffect(() => {
    fetchPets()
    fetchItems()
    if (currentUser) fetchApplications()
  }, [currentUser])

  useEffect(() => {
    if (type && id) fetchComments(type, id)
  }, [type, id])

  if (!currentUser) {
    navigate('/login')
    return null
  }

  const target = type === 'pet'
    ? pets.find((p) => p.id === id) as Pet | undefined
    : items.find((i) => i.id === id) as Item | undefined

  if (!target) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center text-gray-400">
        <p className="text-lg">未找到内容</p>
      </div>
    )
  }

  const alreadyApplied = (appType: 'borrow' | 'adopt') =>
    applications.some(
      (a) => a.targetId === id && a.applicantId === currentUser.id && a.type === appType && a.status === 'pending'
    )

  const handleApply = async () => {
    if (!currentUser || submitting) return
    setSubmitting(true)
    try {
      await submitApplication({
        type: applyType,
        targetType: type as 'pet' | 'item',
        targetId: id!,
        targetName: target.name,
        applicantId: currentUser.id,
        applicantName: currentUser.username,
        ownerId: target.ownerId,
        reason,
        contact,
      })
      setShowApplyModal(false)
      setReason('')
      setContact('')
    } finally {
      setSubmitting(false)
    }
  }

  const handleAddComment = async () => {
    if (!currentUser || !newComment.trim() || !type || !id) return
    await addComment({
      targetType: type,
      targetId: id,
      userId: currentUser.id,
      username: currentUser.username,
      content: newComment.trim(),
      parentId: null,
    })
    setNewComment('')
    setShowEmojis(false)
  }

  const handleReply = async (parentId: string) => {
    if (!currentUser || !replyContent.trim() || !type || !id) return
    await addComment({
      targetType: type,
      targetId: id,
      userId: currentUser.id,
      username: currentUser.username,
      content: replyContent.trim(),
      parentId,
    })
    setReplyTo(null)
    setReplyContent('')
  }

  const rootComments = comments.filter((c) => c.parentId === null)
  const getReplies = (parentId: string) => comments.filter((c) => c.parentId === parentId)

  const isPet = type === 'pet'
  const pet = isPet ? (target as Pet) : null
  const item = !isPet ? (target as Item) : null

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="glass-card overflow-hidden mb-6">
        <img
          src={(isPet ? pet!.photo : item!.image) || 'https://via.placeholder.com/800x400?text=🐾'}
          alt={target.name}
          className="w-full aspect-video object-cover"
        />
        <div className="p-6">
          <h1 className="font-bold text-2xl mb-4">{target.name}</h1>

          {isPet && pet && (
            <div className="flex flex-col gap-2 mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm px-3 py-1 rounded-full bg-warm-orange/15 text-warm-orange font-medium">{pet.breed}</span>
                <span className="text-sm px-3 py-1 rounded-full bg-gray-100 text-gray-500">{pet.age}</span>
              </div>
              <p className="text-gray-600">{pet.personality}</p>
            </div>
          )}

          {!isPet && item && (
            <div className="flex flex-col gap-2 mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm px-3 py-1 rounded-full bg-warm-green/15 text-warm-green font-medium">{item.condition}</span>
              </div>
              {item.location && (
                <div className="flex items-center gap-1 text-gray-500">
                  <MapPin size={16} />
                  <span>{item.location}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-1 text-xs text-gray-400 mb-4">
            <Clock size={14} />
            <span>发布于 {new Date(target.createdAt).toLocaleDateString('zh-CN')}</span>
          </div>

          {target.ownerId !== currentUser.id && (
            <div className="flex gap-3 flex-wrap">
              {isPet && pet && pet.availableForBorrow && (
                alreadyApplied('borrow') ? (
                  <button disabled className="px-5 py-2.5 rounded-lg bg-gray-200 text-gray-500 text-sm font-medium cursor-not-allowed">
                    已申请借出
                  </button>
                ) : (
                  <button
                    className="px-5 py-2.5 bg-warm-orange text-white rounded-lg text-sm font-medium hover:bg-warm-orange-light transition active:scale-95"
                    onClick={() => { setApplyType('borrow'); setShowApplyModal(true) }}
                  >
                    申请借出
                  </button>
                )
              )}
              {isPet && pet && pet.availableForAdoption && (
                alreadyApplied('adopt') ? (
                  <button disabled className="px-5 py-2.5 rounded-lg bg-gray-200 text-gray-500 text-sm font-medium cursor-not-allowed">
                    已申请领养
                  </button>
                ) : (
                  <button
                    className="px-5 py-2.5 bg-warm-green text-white rounded-lg text-sm font-medium hover:bg-warm-green-light transition active:scale-95"
                    onClick={() => { setApplyType('adopt'); setShowApplyModal(true) }}
                  >
                    申请领养
                  </button>
                )
              )}
              {!isPet && item && item.availableForBorrow && (
                alreadyApplied('borrow') ? (
                  <button disabled className="px-5 py-2.5 rounded-lg bg-gray-200 text-gray-500 text-sm font-medium cursor-not-allowed">
                    已申请借出
                  </button>
                ) : (
                  <button
                    className="px-5 py-2.5 bg-warm-orange text-white rounded-lg text-sm font-medium hover:bg-warm-orange-light transition active:scale-95"
                    onClick={() => { setApplyType('borrow'); setShowApplyModal(true) }}
                  >
                    申请借出
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>

      <div className="glass-card p-6">
        <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
          <MessageCircle size={20} /> 评论 ({comments.length})
        </h2>

        <div className="flex gap-2 mb-4 relative">
          <input
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="发表评论..."
            className="flex-1 px-4 py-2.5 rounded-lg bg-white/60 border border-white/40 focus:outline-none focus:ring-2 focus:ring-warm-orange/50 text-sm"
            onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
          />
          <button
            className="p-2 text-gray-400 hover:text-warm-orange transition"
            onClick={() => setShowEmojis(!showEmojis)}
          >
            😊
          </button>
          <button
            className="p-2.5 bg-warm-orange text-white rounded-lg hover:bg-warm-orange-light transition active:scale-95"
            onClick={handleAddComment}
          >
            <Send size={16} />
          </button>
          {showEmojis && (
            <div className="absolute top-12 right-0 glass-card p-3 z-10 emoji-grid w-64">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => { setNewComment((prev) => prev + emoji); setShowEmojis(false) }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {rootComments.map((comment) => (
            <CommentNode
              key={comment.id}
              comment={comment}
              replies={getReplies(comment.id)}
              currentUserId={currentUser.id}
              replyTo={replyTo}
              replyContent={replyContent}
              setReplyTo={setReplyTo}
              setReplyContent={setReplyContent}
              handleReply={handleReply}
              toggleLike={toggleLike}
              getReplies={getReplies}
            />
          ))}
        </div>
      </div>

      {showApplyModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" onClick={() => setShowApplyModal(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="glass-card p-6 w-full max-w-md relative z-10" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-4">
              申请{applyType === 'borrow' ? '借出' : '领养'}
            </h3>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">申请理由</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-white/60 border border-white/40 focus:outline-none focus:ring-2 focus:ring-warm-orange/50 text-sm resize-none"
                  rows={3}
                  placeholder="请说明你的申请理由..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">联系方式</label>
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-white/60 border border-white/40 focus:outline-none focus:ring-2 focus:ring-warm-orange/50 text-sm"
                  placeholder="手机号或微信号"
                />
              </div>
              <button
                className={clsx(
                  'w-full py-2.5 bg-warm-orange text-white rounded-lg font-medium transition',
                  submitting ? 'opacity-60 cursor-not-allowed' : 'hover:bg-warm-orange-light active:scale-[0.98]'
                )}
                disabled={submitting}
                onClick={handleApply}
              >
                {submitting ? '提交中...' : '提交申请'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CommentNode({
  comment,
  replies,
  currentUserId,
  replyTo,
  replyContent,
  setReplyTo,
  setReplyContent,
  handleReply,
  toggleLike,
  getReplies,
}: {
  comment: Comment
  replies: Comment[]
  currentUserId: string
  replyTo: string | null
  replyContent: string
  setReplyTo: (id: string | null) => void
  setReplyContent: (v: string) => void
  handleReply: (parentId: string) => Promise<void>
  toggleLike: (id: string) => Promise<void>
  getReplies: (parentId: string) => Comment[]
}) {
  const isLiked = comment.likes.includes(currentUserId)

  return (
    <div>
      <div className="flex gap-3">
        <div
          className="avatar-circle w-8 h-8 text-xs flex-shrink-0"
          style={{ backgroundColor: getAvatarColor(comment.username) }}
        >
          {comment.username[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{comment.username}</span>
            <span className="text-xs text-gray-400">{new Date(comment.createdAt).toLocaleString('zh-CN')}</span>
          </div>
          <p className="text-sm text-gray-700 mt-1">{comment.content}</p>
          <div className="flex items-center gap-4 mt-2">
            <button
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-400 transition"
              onClick={() => toggleLike(comment.id)}
            >
              <Heart size={14} className={clsx(isLiked && 'fill-red-400 text-red-400')} />
              <span>{comment.likes.length || ''}</span>
            </button>
            <button
              className="text-xs text-gray-400 hover:text-warm-orange transition"
              onClick={() => { setReplyTo(replyTo === comment.id ? null : comment.id); setReplyContent('') }}
            >
              回复
            </button>
          </div>

          {replyTo === comment.id && (
            <div className="flex gap-2 mt-2">
              <input
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder={`回复 ${comment.username}...`}
                className="flex-1 px-3 py-2 rounded-lg bg-white/60 border border-white/40 focus:outline-none focus:ring-2 focus:ring-warm-orange/50 text-sm"
                onKeyDown={(e) => e.key === 'Enter' && handleReply(comment.id)}
              />
              <button
                className="p-2 bg-warm-orange text-white rounded-lg hover:bg-warm-orange-light transition active:scale-95"
                onClick={() => handleReply(comment.id)}
              >
                <Send size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {replies.length > 0 && (
        <div className="comment-indent mt-3 flex flex-col gap-3">
          {replies.map((reply) => (
            <CommentNode
              key={reply.id}
              comment={reply}
              replies={getReplies(reply.id)}
              currentUserId={currentUserId}
              replyTo={replyTo}
              replyContent={replyContent}
              setReplyTo={setReplyTo}
              setReplyContent={setReplyContent}
              handleReply={handleReply}
              toggleLike={toggleLike}
              getReplies={getReplies}
            />
          ))}
        </div>
      )}
    </div>
  )
}
