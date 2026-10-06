import { FormEvent, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle } from 'lucide-react';
import { Recipe } from '../types';
import { api } from '../utils/api';
import { useApp } from '../App';

const NICKNAME_KEY = 'recipe-app-nickname';

interface CommentSectionProps {
  recipe: Recipe;
}

export default function CommentSection({ recipe }: CommentSectionProps) {
  const { appendComment, showToast } = useApp();
  const [nickname, setNickname] = useState(() => localStorage.getItem(NICKNAME_KEY) || '');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedNickname = nickname.trim();
    const trimmedContent = content.trim();
    if (!trimmedNickname || !trimmedContent) {
      showToast('请填写昵称和评论内容', 'error');
      return;
    }
    if (submitting) return; // 防止重复提交
    setSubmitting(true);
    try {
      const comment = await api.addComment(recipe.id, trimmedNickname, trimmedContent);
      appendComment(recipe.id, comment);
      localStorage.setItem(NICKNAME_KEY, trimmedNickname);
      setContent('');
      showToast('评论发表成功');
    } catch {
      // 失败时保留输入内容，便于重试
      showToast('评论发表失败，请稍后重试', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="detail-section comment-section">
      <h2>
        <MessageCircle size={22} />
        评论区
        <span className="section-progress">{recipe.comments.length} 条评论</span>
      </h2>
      <form className="comment-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="你的昵称"
          value={nickname}
          maxLength={20}
          onChange={e => setNickname(e.target.value)}
        />
        <textarea
          placeholder="分享你的烹饪心得…"
          value={content}
          rows={3}
          maxLength={500}
          onChange={e => setContent(e.target.value)}
        />
        <button type="submit" className="primary-btn" disabled={submitting}>
          {submitting ? '发表中…' : '发表评论'}
        </button>
      </form>
      <ul className="comment-list">
        <AnimatePresence initial={false}>
          {recipe.comments.map(comment => (
            <motion.li
              key={comment.id}
              className="comment-item"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="comment-header">
                <span className="comment-nickname">{comment.nickname}</span>
                <span className="comment-time">{new Date(comment.createdAt).toLocaleString('zh-CN')}</span>
              </div>
              <p className="comment-content">{comment.content}</p>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}
