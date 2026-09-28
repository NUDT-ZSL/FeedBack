import { useState, useRef } from 'react';
import { Send, CheckCircle, Music, Users, Mail, Tag, FileText } from 'lucide-react';
import { bandsApi } from '../services/api';
import { useStore } from '../store/useStore';
import './ApplyForm.css';

const genreOptions = [
  '摇滚', '独立', '电子', '流行', '民谣', '后摇',
  '嘻哈', '爵士', '金属', '朋克', '古典', '实验'
];

export default function ApplyForm() {
  const { addNotification } = useStore();

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    genres: [] as string[],
    memberCount: '',
    contact: ''
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const requestIdRef = useRef<string>('');

  const generateRequestId = (): string => {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = '请输入乐队名称';
    }

    if (!formData.description.trim()) {
      newErrors.description = '请输入乐队简介';
    } else if (formData.description.trim().length < 10) {
      newErrors.description = '简介至少10个字';
    }

    if (formData.genres.length === 0) {
      newErrors.genres = '请选择至少一个音乐风格';
    }

    if (!formData.memberCount || parseInt(formData.memberCount) <= 0) {
      newErrors.memberCount = '请输入有效的成员数';
    }

    if (!formData.contact.trim()) {
      newErrors.contact = '请输入联系方式';
    } else if (!/^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/.test(formData.contact) && !/^1[3-9]\d{9}$/.test(formData.contact)) {
      newErrors.contact = '请输入有效的邮箱或手机号';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleGenreToggle = (genre: string) => {
    setFormData(prev => ({
      ...prev,
      genres: prev.genres.includes(genre)
        ? prev.genres.filter(g => g !== genre)
        : [...prev.genres, genre]
    }));
    if (errors.genres) {
      setErrors(prev => ({ ...prev, genres: '' }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;
    if (submitting) return;

    setSubmitting(true);

    if (!requestIdRef.current) {
      requestIdRef.current = generateRequestId();
    }

    try {
      const result = await bandsApi.createBand({
        name: formData.name.trim(),
        description: formData.description.trim(),
        genres: formData.genres,
        memberCount: parseInt(formData.memberCount),
        contact: formData.contact.trim(),
        requestId: requestIdRef.current
      });

      setSubmitted(true);
      addNotification({
        message: result.message,
        type: 'success'
      });
    } catch (error: any) {
      addNotification({
        message: error.message || '提交失败，请重试',
        type: 'error'
      });
    } finally {
      setSubmitting(false);
      requestIdRef.current = '';
    }
  };

  const handleReset = () => {
    setFormData({
      name: '',
      description: '',
      genres: [],
      memberCount: '',
      contact: ''
    });
    setErrors({});
    setSubmitted(false);
  };

  if (submitted) {
    return (
      <div className="apply-page">
        <div className="apply-container success-card fade-in">
          <div className="success-icon">
            <CheckCircle size={64} />
          </div>
          <h2>申请已提交</h2>
          <p>感谢您的报名！我们会尽快审核您的申请，请耐心等待。</p>
          <button className="btn-secondary" onClick={handleReset}>
            继续提交新申请
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="apply-page">
      <div className="apply-container fade-in">
        <div className="form-header">
          <h1 className="form-title">乐队报名申请</h1>
          <p className="form-subtitle">加入星空音乐节，让你的音乐被更多人听见</p>
        </div>

        <form onSubmit={handleSubmit} className="apply-form">
          <div className="form-group">
            <label className="form-label">
              <Music size={18} />
              乐队名称
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, name: e.target.value }));
                if (errors.name) setErrors(prev => ({ ...prev, name: '' }));
              }}
              placeholder="请输入乐队名称"
              className={`form-input ${errors.name ? 'error' : ''}`}
              maxLength={50}
            />
            {errors.name && <span className="form-error">{errors.name}</span>}
          </div>

          <div className="form-group">
            <label className="form-label">
              <FileText size={18} />
              乐队简介
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, description: e.target.value }));
                if (errors.description) setErrors(prev => ({ ...prev, description: '' }));
              }}
              placeholder="介绍一下你们的乐队、音乐风格、演出经历等"
              className={`form-textarea ${errors.description ? 'error' : ''}`}
              rows={4}
              maxLength={500}
            />
            <div className="char-count">{formData.description.length}/500</div>
            {errors.description && <span className="form-error">{errors.description}</span>}
          </div>

          <div className="form-group">
            <label className="form-label">
              <Tag size={18} />
              音乐风格
            </label>
            <div className="genres-container">
              {genreOptions.map(genre => (
                <button
                  key={genre}
                  type="button"
                  className={`genre-chip ${formData.genres.includes(genre) ? 'selected' : ''}`}
                  onClick={() => handleGenreToggle(genre)}
                >
                  {genre}
                </button>
              ))}
            </div>
            {errors.genres && <span className="form-error">{errors.genres}</span>}
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">
                <Users size={18} />
                成员人数
              </label>
              <input
                type="number"
                value={formData.memberCount}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, memberCount: e.target.value }));
                  if (errors.memberCount) setErrors(prev => ({ ...prev, memberCount: '' }));
                }}
                placeholder="人数"
                className={`form-input ${errors.memberCount ? 'error' : ''}`}
                min="1"
                max="20"
              />
              {errors.memberCount && <span className="form-error">{errors.memberCount}</span>}
            </div>

            <div className="form-group">
              <label className="form-label">
                <Mail size={18} />
                联系方式
              </label>
              <input
                type="text"
                value={formData.contact}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, contact: e.target.value }));
                  if (errors.contact) setErrors(prev => ({ ...prev, contact: '' }));
                }}
                placeholder="邮箱或手机号"
                className={`form-input ${errors.contact ? 'error' : ''}`}
              />
              {errors.contact && <span className="form-error">{errors.contact}</span>}
            </div>
          </div>

          <button
            type="submit"
            className="btn-primary submit-btn"
            disabled={submitting}
          >
            {submitting ? (
              <span className="btn-loading">提交中...</span>
            ) : (
              <>
                <Send size={18} />
                提交申请
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
