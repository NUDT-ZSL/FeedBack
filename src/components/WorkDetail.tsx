import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FaArrowLeft, FaClock, FaHeart, FaComment, FaPaperPlane } from 'react-icons/fa';
import { Work, Comment, WorkStep, categoryConfig } from '../types';
import { CategoryBadge } from './CategoryBadge';
import { StepCard } from './StepCard';
import { CommentCard } from './CommentCard';
import { StarRating } from './StarRating';
import { useRipple } from '../hooks/useRipple';

interface WorkDetailProps {
  works: Work[];
  onAddComment: (workId: string, comment: Comment) => void;
}

export const WorkDetail: React.FC<WorkDetailProps> = ({ works, onAddComment }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const work = works.find(w => w.id === id);

  const [showComments, setShowComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [newRating, setNewRating] = useState(5);
  const [draggedStep, setDraggedStep] = useState<string | null>(null);
  const [steps, setSteps] = useState<WorkStep[]>(work?.steps || []);

  const categoryColor = work ? categoryConfig[work.category].color : '#D2B48C';
  const createRipple = useRipple(`${categoryColor}80`);

  if (!work) {
    return (
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 24px', textAlign: 'center' }}>
        <h2 style={{ marginBottom: '16px' }}>作品不存在</h2>
        <button
          onClick={() => navigate('/')}
          style={{
            padding: '12px 24px',
            backgroundColor: 'var(--text-title)',
            color: '#FFFFFF',
            borderRadius: '12px',
            fontSize: '16px',
          }}
        >
          返回首页
        </button>
      </div>
    );
  }

  const totalDuration = steps.reduce((sum, step) => sum + step.duration, 0);
  const averageRating = work.comments.length > 0
    ? work.comments.reduce((sum, c) => sum + c.rating, 0) / work.comments.length
    : 0;
  const sortedComments = [...work.comments].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const handleDragStart = (e: React.DragEvent, stepId: string) => {
    setDraggedStep(stepId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetStepId: string) => {
    e.preventDefault();
    if (!draggedStep || draggedStep === targetStepId) return;

    const newSteps = [...steps];
    const draggedIndex = newSteps.findIndex(s => s.id === draggedStep);
    const targetIndex = newSteps.findIndex(s => s.id === targetStepId);

    const [removed] = newSteps.splice(draggedIndex, 1);
    newSteps.splice(targetIndex, 0, removed);

    const reorderedSteps = newSteps.map((step, index) => ({
      ...step,
      order: index + 1,
    }));

    setSteps(reorderedSteps);
    setDraggedStep(null);
    toast.success('步骤顺序已更新');
  };

  const handleDragEnd = () => {
    setDraggedStep(null);
  };

  const handleSubmitComment = () => {
    if (!newComment.trim()) {
      toast.error('请输入评论内容');
      return;
    }
    if (newComment.length > 150) {
      toast.error('评论内容不能超过150字');
      return;
    }

    const comment: Comment = {
      id: Math.random().toString(36).substring(2, 9),
      workId: work.id,
      author: '访客用户',
      avatarColor: `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`,
      rating: newRating,
      content: newComment.trim(),
      createdAt: new Date().toISOString(),
    };

    onAddComment(work.id, comment);
    setNewComment('');
    setNewRating(5);
    toast.success('评论发表成功');
  };

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}小时${mins}分钟`;
    }
    return `${mins}分钟`;
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 24px' }}>
      <button
        onClick={() => navigate('/')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '24px',
          fontSize: '16px',
          color: 'var(--text-title)',
          fontWeight: 500,
          transition: 'transform 0.2s var(--easing-standard)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateX(-4px)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateX(0)';
        }}
      >
        <FaArrowLeft size={18} />
        返回作品列表
      </button>

      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--shadow-card)',
          padding: 'var(--padding-card)',
          marginBottom: '32px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h1 style={{ fontSize: '32px', marginBottom: '12px' }}>{work.name}</h1>
            <CategoryBadge category={work.category} />
          </div>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
              <FaClock size={16} />
              <span>{formatDuration(totalDuration)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
              <FaHeart size={16} style={{ color: '#E91E63' }} />
              <span>{work.favorites}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
              <FaComment size={16} />
              <span>{work.comments.length}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '16px' }}>
          <StarRating value={averageRating} readonly size={20} />
          <span style={{ color: 'var(--text-muted)' }}>
            ({work.comments.length} 条评价)
          </span>
        </div>
      </div>

      <h2 style={{ fontSize: '24px', marginBottom: '20px' }}>制作步骤</h2>

      <div style={{ marginBottom: '32px' }}>
        {steps.map((step, index) => (
          <StepCard
            key={step.id}
            step={step}
            isDragging={draggedStep === step.id}
            onDragStart={(e) => handleDragStart(e, step.id)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, step.id)}
            onDragEnd={handleDragEnd}
            draggable={true}
            showConnector={index < steps.length - 1}
          />
        ))}
      </div>

      <button
        className="ripple-container"
        onClick={(e) => {
          createRipple(e);
          setShowComments(!showComments);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          width: '100%',
          padding: '16px',
          backgroundColor: categoryColor,
          color: work.category === 'paper' ? '#5D4037' : '#FFFFFF',
          borderRadius: 'var(--radius-card)',
          fontSize: '16px',
          fontWeight: 500,
          marginBottom: '24px',
          transition: 'transform 0.2s var(--easing-standard), box-shadow 0.2s var(--easing-standard)',
          boxShadow: `0 4px 12px ${categoryColor}66`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = `0 6px 20px ${categoryColor}99`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = `0 4px 12px ${categoryColor}66`;
        }}
      >
        <FaComment size={18} />
        {showComments ? '收起评论' : `展开评论 (${work.comments.length})`}
      </button>

      {showComments && (
        <div>
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 'var(--radius-card)',
              boxShadow: 'var(--shadow-card)',
              padding: 'var(--padding-card)',
              marginBottom: '24px',
            }}
          >
            <h3 style={{ fontSize: '18px', marginBottom: '16px' }}>发表评论</h3>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '14px' }}>
                评分
              </label>
              <StarRating value={newRating} onChange={setNewRating} size={28} />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '14px' }}>
                留言 ({newComment.length}/150)
              </label>
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value.slice(0, 150))}
                placeholder="分享你的看法..."
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: '12px',
                  border: '2px solid #E0E0E0',
                  fontSize: '16px',
                  resize: 'vertical',
                  minHeight: '100px',
                  outline: 'none',
                  transition: 'border-color 0.2s var(--easing-standard)',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = categoryColor;
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#E0E0E0';
                }}
              />
            </div>

            <button
              className="ripple-container"
              onClick={(e) => {
                createRipple(e);
                handleSubmitComment();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '12px 24px',
                backgroundColor: 'var(--text-title)',
                color: '#FFFFFF',
                borderRadius: '12px',
                fontSize: '16px',
                fontWeight: 500,
                transition: 'transform 0.2s var(--easing-standard), box-shadow 0.2s var(--easing-standard)',
                boxShadow: '0 4px 12px rgba(62, 39, 35, 0.3)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(62, 39, 35, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(62, 39, 35, 0.3)';
              }}
            >
              <FaPaperPlane size={16} />
              发表评论
            </button>
          </div>

          <h3 style={{ fontSize: '18px', marginBottom: '16px' }}>
            评论 ({sortedComments.length})
          </h3>

          {sortedComments.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '48px',
                color: 'var(--text-muted)',
                backgroundColor: '#FFFFFF',
                borderRadius: 'var(--radius-card)',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              暂无评论，快来发表第一条评论吧！
            </div>
          ) : (
            sortedComments.map((comment, index) => (
              <CommentCard key={comment.id} comment={comment} index={index} />
            ))
          )}
        </div>
      )}
    </div>
  );
};
