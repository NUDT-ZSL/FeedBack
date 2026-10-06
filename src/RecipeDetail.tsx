import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, ArrowLeft, Clock, CheckCircle2, Circle } from 'lucide-react';
import { useApp } from './App';
import FavoriteButton from './components/FavoriteButton';
import CommentSection from './components/CommentSection';

export default function RecipeDetail() {
  const { id } = useParams<{ id: string }>();
  const { recipes, loading, error, reload, toggleLike, patchIngredient, patchStep } = useApp();
  const [likePending, setLikePending] = useState(false);
  const [likeBounce, setLikeBounce] = useState(false);
  const [scrollY, setScrollY] = useState(0);

  const recipe = recipes.find(r => r.id === id);

  // 视差滚动：大图随滚动轻微放大
  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (loading) {
    return (
      <div className="page-status">
        <div className="loading-spinner" />
        <p>正在加载菜谱详情…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-status">
        <div className="empty-illustration">🍳</div>
        <p>{error}</p>
        <button className="primary-btn" onClick={reload}>
          重新加载
        </button>
      </div>
    );
  }

  if (!recipe) {
    return (
      <div className="page-status">
        <div className="empty-illustration">🍽️</div>
        <p>菜谱不存在或已被删除</p>
        <Link to="/" className="primary-btn">
          返回首页
        </Link>
      </div>
    );
  }

  const handleLike = async () => {
    if (likePending) return; // 防止重复点击
    setLikePending(true);
    setLikeBounce(true);
    window.setTimeout(() => setLikeBounce(false), 300);
    try {
      await toggleLike(recipe);
    } finally {
      setLikePending(false);
    }
  };

  const checkedCount = recipe.ingredients.filter(i => i.checked).length;
  const expandedCount = recipe.steps.filter(s => s.expanded).length;
  const heroScale = 1 + Math.min(scrollY / 2000, 0.15);
  const heroBlur = Math.min(scrollY / 300, 4);

  return (
    <div className="recipe-detail">
      <div className="detail-hero">
        <img
          src={recipe.image}
          alt={recipe.title}
          style={{ transform: `scale(${heroScale})`, filter: `blur(${heroBlur}px)` }}
        />
        <div className="detail-hero-overlay">
          <div className="container">
            <Link to="/" className="back-link">
              <ArrowLeft size={18} />
              返回首页
            </Link>
            <h1>{recipe.title}</h1>
            <div className="detail-hero-meta">
              <img src={recipe.authorAvatar} alt={recipe.author} className="author-avatar" />
              <span>{recipe.author}</span>
              <span className="meta-divider">·</span>
              <Clock size={14} />
              <span>{new Date(recipe.createdAt).toLocaleDateString('zh-CN')}</span>
              <span className="meta-divider">·</span>
              <span className="recipe-card-category">{recipe.category}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="container detail-body">
        <div className="detail-actions">
          <button
            className={`like-btn${recipe.liked ? ' liked' : ''}${likeBounce ? ' animate-bounce-in' : ''}`}
            onClick={handleLike}
            disabled={likePending}
          >
            <Heart size={20} fill={recipe.liked ? 'currentColor' : 'none'} />
            <span>{recipe.likes}</span>
          </button>
          <FavoriteButton recipe={recipe} size={20} showLabel />
        </div>

        <p className="detail-description">{recipe.description}</p>

        <div className="detail-tags">
          {recipe.tags.map(tag => (
            <span key={tag} className="recipe-tag">
              {tag}
            </span>
          ))}
        </div>

        <section className="detail-section">
          <h2>
            食材清单
            <span className="section-progress">
              {checkedCount}/{recipe.ingredients.length} 已准备
            </span>
          </h2>
          <ul className="ingredient-list">
            {recipe.ingredients.map((ingredient, index) => (
              <li key={index}>
                <label className={`ingredient-item${ingredient.checked ? ' checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={ingredient.checked}
                    onChange={e => patchIngredient(recipe.id, index, e.target.checked)}
                  />
                  <span className="ingredient-name">{ingredient.name}</span>
                  {ingredient.checked && <span className="ingredient-done">已准备</span>}
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section className="detail-section">
          <h2>
            烹饪步骤
            <span className="section-progress">
              {expandedCount}/{recipe.steps.length} 已展开
            </span>
          </h2>
          <div className="step-list">
            {recipe.steps.map((step, index) => (
              <div key={step.id} className={`step-item${step.expanded ? ' expanded' : ''}`}>
                <button className="step-header" onClick={() => patchStep(recipe.id, index, !step.expanded)}>
                  <span className="step-number">{step.expanded ? <CheckCircle2 size={20} /> : <Circle size={20} />}</span>
                  <span className="step-title">步骤 {step.id}</span>
                  <span className="step-toggle">{step.expanded ? '收起' : '展开'}</span>
                </button>
                <AnimatePresence initial={false}>
                  {step.expanded && (
                    <motion.div
                      className="step-content"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                    >
                      <p>{step.content}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </section>

        <CommentSection recipe={recipe} />
      </div>
    </div>
  );
}
