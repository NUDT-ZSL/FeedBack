import { useState, useRef, useEffect } from 'react'
import { Send, Smile, AtSign } from 'lucide-react'
import { getCommentsByWorkId, addComment, hashUsernameToColor, getInitials } from '../data/mockData'
import type { Comment } from '../data/mockData'
import toast from 'react-hot-toast'

const EMOJI_LIST = [
  '😀', '😂', '🥰', '😍', '🤩', '😊', '😎', '🥳',
  '😢', '😭', '😡', '🤔', '😴', '🤗', '😇', '🤭',
  '👍', '👎', '👏', '🙌', '🤝', '💪', '✌️', '🤞',
  '❤️', '💖', '💔', '💕', '💯', '🔥', '⭐', '🌟',
  '🎵', '🎶', '🎸', '🎹', '🎷', '🎺', '🥁', '🎤',
  '🎉', '🎊', '🏆', '💎', '🌹', '🌸', '☀️', '🌈',
]

interface CommentSectionProps {
  workId: string
}

export default function CommentSection({ workId }: CommentSectionProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [inputValue, setInputValue] = useState('')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showMentionList, setShowMentionList] = useState(false)
  const [mentionSearch, setMentionSearch] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const emojiRef = useRef<HTMLDivElement>(null)

  const currentUser = { id: 'fan-current', name: '当前用户' }

  useEffect(() => {
    setComments(getCommentsByWorkId(workId))
  }, [workId])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const uniqueUsers = Array.from(new Set(comments.map(c => c.username)))
    .filter(u => u.toLowerCase().includes(mentionSearch.toLowerCase()))

  const handleEmojiSelect = (emoji: any) => {
    setInputValue(prev => prev + emoji.native)
    setShowEmojiPicker(false)
    inputRef.current?.focus()
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInputValue(value)

    const lastAtIndex = value.lastIndexOf('@')
    if (lastAtIndex !== -1 && lastAtIndex === value.length - 1) {
      setShowMentionList(true)
      setMentionSearch('')
    } else if (lastAtIndex !== -1) {
      const searchPart = value.slice(lastAtIndex + 1)
      if (!searchPart.includes(' ')) {
        setShowMentionList(true)
        setMentionSearch(searchPart)
      } else {
        setShowMentionList(false)
      }
    } else {
      setShowMentionList(false)
    }
  }

  const handleMentionSelect = (username: string) => {
    const lastAtIndex = inputValue.lastIndexOf('@')
    const newValue = inputValue.slice(0, lastAtIndex) + `@${username} `
    setInputValue(newValue)
    setShowMentionList(false)
    inputRef.current?.focus()
  }

  const handleSubmit = () => {
    if (!inputValue.trim()) {
      toast.error('评论内容不能为空')
      return
    }

    const mentions = inputValue.match(/@(\S+)/g)?.map(m => m.slice(1)) || []

    const newComment = addComment(
      workId,
      currentUser.id,
      currentUser.name,
      inputValue.trim(),
      mentions
    )

    setComments([newComment, ...comments])
    setInputValue('')
    toast.success('评论发表成功')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const formatDate = (date: Date) => {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes}分钟前`
    if (hours < 24) return `${hours}小时前`
    if (days < 7) return `${days}天前`
    return date.toLocaleDateString('zh-CN')
  }

  const highlightMentions = (content: string) => {
    const parts = content.split(/(@\S+)/g)
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return (
          <span key={i} className="text-pink-400 hover:text-pink-300 cursor-pointer">
            {part}
          </span>
        )
      }
      return <span key={i}>{part}</span>
    })
  }

  return (
    <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
      <h3 className="text-lg font-semibold mb-6">评论区 ({comments.length})</h3>

      <div className="relative mb-6">
        <div className="flex gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
            style={{ backgroundColor: hashUsernameToColor(currentUser.name) }}
          >
            {getInitials(currentUser.name)}
          </div>
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="写下你的评论...  Enter 发送，Shift+Enter 换行"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 resize-none focus:border-pink-500/50 focus:ring-2 focus:ring-pink-500/20 transition-all duration-300"
              rows={3}
            />
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-2">
                <div className="relative" ref={emojiRef}>
                  <button
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-all duration-300"
                  >
                    <Smile size={18} />
                  </button>
                  {showEmojiPicker && (
                    <div
                      className="absolute bottom-full left-0 mb-2 z-10 animate-scaleIn bg-gray-900/95 backdrop-blur-sm border border-white/10 rounded-xl p-3 shadow-2xl"
                      style={{ transformOrigin: 'bottom left', width: '280px' }}
                    >
                      <div className="grid grid-cols-8 gap-1">
                        {EMOJI_LIST.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => handleEmojiSelect({ native: emoji })}
                            className="w-8 h-8 flex items-center justify-center text-lg hover:bg-white/10 rounded-lg transition-colors"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setInputValue(prev => prev + '@')}
                  className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-all duration-300"
                >
                  <AtSign size={18} />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/40">{inputValue.length}/500</span>
                <button
                  onClick={handleSubmit}
                  className="px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-500 rounded-lg text-white text-sm font-medium hover:shadow-[0_0_20px_rgba(233,69,96,0.4)] transition-all duration-300 flex items-center gap-2"
                >
                  <Send size={14} />
                  <span>发送</span>
                </button>
              </div>
            </div>

            {showMentionList && uniqueUsers.length > 0 && (
              <div className="absolute top-full left-0 mt-1 bg-gray-900 border border-white/10 rounded-lg overflow-hidden z-20 min-w-[150px] animate-fadeIn">
                {uniqueUsers.map((username) => (
                  <button
                    key={username}
                    onClick={() => handleMentionSelect(username)}
                    className="w-full px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10 transition-colors"
                  >
                    @{username}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
        {comments.map((comment) => (
          <div key={comment.id} className="flex gap-3 animate-fadeIn">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
              style={{ backgroundColor: hashUsernameToColor(comment.username) }}
            >
              {getInitials(comment.username)}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-white/90">{comment.username}</span>
                <span className="text-xs text-white/40">{formatDate(comment.createdAt)}</span>
              </div>
              <p className="text-sm text-white/70 leading-relaxed">
                {highlightMentions(comment.content)}
              </p>
            </div>
          </div>
        ))}

        {comments.length === 0 && (
          <div className="text-center py-10">
            <p className="text-white/40">暂无评论，快来抢沙发吧～</p>
          </div>
        )}
      </div>
    </div>
  )
}
