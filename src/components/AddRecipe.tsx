import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../utils/api';
import { useApp } from '../App';
import { NewRecipeData } from '../types';

const DRAFT_KEY = 'recipe-app-draft';
const AUTHOR_KEY = 'recipe-app-nickname';
const FALLBACK_CATEGORIES = ['中餐', '西餐', '日料', '韩餐', '甜点', '饮品', '素食'];

interface DraftData {
  title: string;
  author: string;
  description: string;
  category: string;
  tags: string;
  ingredients: string[];
  steps: string[];
  image: string;
}

const emptyDraft = (): DraftData => ({
  title: '',
  author: localStorage.getItem(AUTHOR_KEY) || '',
  description: '',
  category: '',
  tags: '',
  ingredients: [''],
  steps: [''],
  image: '',
});

function loadDraft(): DraftData {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return { ...emptyDraft(), ...JSON.parse(raw) };
  } catch {
    // 草稿损坏时忽略，使用空草稿
  }
  return emptyDraft();
}

export default function AddRecipe() {
  const navigate = useNavigate();
  const { prependRecipe, showToast } = useApp();
  const [form, setForm] = useState<DraftData>(loadDraft);
  const [categories, setCategories] = useState<string[]>(FALLBACK_CATEGORIES);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .getCategories()
      .then(setCategories)
      .catch(() => setCategories(FALLBACK_CATEGORIES));
  }, []);

  // 草稿自动保存：刷新或提交失败后再次进入可恢复
  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [form]);

  const update = <K extends keyof DraftData>(key: K, value: DraftData[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const updateListItem = (key: 'ingredients' | 'steps', index: number, value: string) => {
    setForm(prev => ({
      ...prev,
      [key]: prev[key].map((item, i) => (i === index ? value : item)),
    }));
  };

  const addListItem = (key: 'ingredients' | 'steps') => {
    setForm(prev => ({ ...prev, [key]: [...prev[key], ''] }));
  };

  const removeListItem = (key: 'ingredients' | 'steps', index: number) => {
    setForm(prev => ({
      ...prev,
      [key]: prev[key].length > 1 ? prev[key].filter((_, i) => i !== index) : prev[key],
    }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return; // 防止重复提交

    const payload: NewRecipeData = {
      title: form.title.trim(),
      author: form.author.trim(),
      description: form.description.trim(),
      category: form.category,
      tags: form.tags
        .split(/[,，]/)
        .map(t => t.trim())
        .filter(Boolean),
      ingredients: form.ingredients.map(i => i.trim()).filter(Boolean),
      steps: form.steps.map(s => s.trim()).filter(Boolean),
    };
    if (form.image.trim()) payload.image = form.image.trim();

    if (!payload.title || !payload.author || !payload.description || !payload.category) {
      showToast('请填写完整的菜谱信息', 'error');
      return;
    }
    if (payload.ingredients.length === 0 || payload.steps.length === 0) {
      showToast('请至少添加一条食材和一个步骤', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.createRecipe(payload);
      prependRecipe(created);
      localStorage.removeItem(DRAFT_KEY);
      localStorage.setItem(AUTHOR_KEY, payload.author);
      showToast('菜谱发布成功！');
      navigate(`/recipe/${created.id}`);
    } catch {
      // 失败时草稿已自动保存，可直接重试
      showToast('发布失败，请稍后重试（草稿已保存）', 'error');
      setSubmitting(false);
    }
  };

  return (
    <main className="container add-recipe-page">
      <header className="home-header">
        <h1>发布新菜谱</h1>
        <p>分享你的拿手好菜，灵感会自动保存为草稿</p>
      </header>
      <form className="add-recipe-form" onSubmit={handleSubmit}>
        <div className="form-row">
          <label className="form-field">
            <span>菜谱名称 *</span>
            <input
              type="text"
              value={form.title}
              maxLength={50}
              placeholder="如：红烧肉"
              onChange={e => update('title', e.target.value)}
            />
          </label>
          <label className="form-field">
            <span>作者昵称 *</span>
            <input
              type="text"
              value={form.author}
              maxLength={20}
              placeholder="你的昵称"
              onChange={e => update('author', e.target.value)}
            />
          </label>
        </div>

        <label className="form-field">
          <span>菜谱简介 *</span>
          <textarea
            value={form.description}
            rows={3}
            maxLength={200}
            placeholder="一句话介绍这道菜的魅力…"
            onChange={e => update('description', e.target.value)}
          />
        </label>

        <div className="form-row">
          <label className="form-field">
            <span>分类 *</span>
            <select value={form.category} onChange={e => update('category', e.target.value)}>
              <option value="">请选择分类</option>
              {categories.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>标签（逗号分隔）</span>
            <input
              type="text"
              value={form.tags}
              placeholder="如：家常菜, 下饭"
              onChange={e => update('tags', e.target.value)}
            />
          </label>
        </div>

        <label className="form-field">
          <span>封面图片 URL（可选，留空自动生成）</span>
          <input
            type="url"
            value={form.image}
            placeholder="https://…"
            onChange={e => update('image', e.target.value)}
          />
        </label>

        <div className="form-field">
          <span>食材清单 *</span>
          {form.ingredients.map((ingredient, index) => (
            <div className="list-input-row" key={index}>
              <input
                type="text"
                value={ingredient}
                placeholder={`食材 ${index + 1}，如：五花肉 500g`}
                onChange={e => updateListItem('ingredients', index, e.target.value)}
              />
              <button
                type="button"
                className="icon-btn"
                onClick={() => removeListItem('ingredients', index)}
                aria-label="删除食材"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button type="button" className="secondary-btn" onClick={() => addListItem('ingredients')}>
            <Plus size={16} /> 添加食材
          </button>
        </div>

        <div className="form-field">
          <span>烹饪步骤 *</span>
          {form.steps.map((step, index) => (
            <div className="list-input-row" key={index}>
              <textarea
                value={step}
                rows={2}
                placeholder={`步骤 ${index + 1}`}
                onChange={e => updateListItem('steps', index, e.target.value)}
              />
              <button
                type="button"
                className="icon-btn"
                onClick={() => removeListItem('steps', index)}
                aria-label="删除步骤"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button type="button" className="secondary-btn" onClick={() => addListItem('steps')}>
            <Plus size={16} /> 添加步骤
          </button>
        </div>

        <button type="submit" className="primary-btn submit-btn" disabled={submitting}>
          {submitting ? '发布中…' : '发布菜谱'}
        </button>
      </form>
    </main>
  );
}
