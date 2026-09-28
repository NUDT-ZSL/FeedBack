import React, { useState, useEffect } from 'react';
import { TagType, TAG_OPTIONS } from '../utils';

interface ModalFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    description: string;
    tag: TagType;
    imageUrl?: string;
  }) => void;
  lat: number;
  lng: number;
}

const ModalForm: React.FC<ModalFormProps> = ({ isOpen, onClose, onSubmit, lat, lng }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tag, setTag] = useState<TagType>('vegetation');
  const [imageUrl, setImageUrl] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      setName('');
      setDescription('');
      setTag('vegetation');
      setImageUrl('');
      setErrors({});
    }
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) {
      newErrors.name = '请输入采样点名称';
    }
    if (imageUrl.trim() && !isValidUrl(imageUrl.trim())) {
      newErrors.imageUrl = '请输入有效的图片URL';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const isValidUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    onSubmit({
      name: name.trim(),
      description: description.trim(),
      tag,
      imageUrl: imageUrl.trim() || undefined
    });
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            <i className="fas fa-map-pin" style={{ marginRight: '8px', color: '#8B4513' }}></i>
            新建采样点
          </h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">GPS 坐标</label>
              <div className="coords-display">
                <i className="fas fa-location-crosshairs" style={{ marginRight: '8px' }}></i>
                纬度: {lat.toFixed(6)}, 经度: {lng.toFixed(6)}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">
                采样点名称 <span style={{ color: '#c0392b' }}>*</span>
              </label>
              <input
                type="text"
                className={`form-input ${errors.name ? 'error' : ''}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：A区土壤采样点01"
                autoFocus
              />
              {errors.name && (
                <div style={{ color: '#c0392b', fontSize: '12px', marginTop: '4px' }}>
                  <i className="fas fa-exclamation-circle" style={{ marginRight: '4px' }}></i>
                  {errors.name}
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">标签类型</label>
              <select
                className="form-select"
                value={tag}
                onChange={(e) => setTag(e.target.value as TagType)}
              >
                {TAG_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="form-hint">
                <span
                  style={{
                    display: 'inline-block',
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: TAG_OPTIONS.find((t) => t.value === tag)?.color,
                    marginRight: '6px',
                    verticalAlign: 'middle'
                  }}
                ></span>
                颜色根据标签类型自动设置
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">描述笔记</label>
              <textarea
                className="form-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="记录采样点的详细描述、观察结果、环境条件等..."
                rows={4}
              />
            </div>

            <div className="form-group">
              <label className="form-label">图片URL</label>
              <input
                type="url"
                className={`form-input ${errors.imageUrl ? 'error' : ''}`}
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://example.com/photo.jpg"
              />
              {errors.imageUrl && (
                <div style={{ color: '#c0392b', fontSize: '12px', marginTop: '4px' }}>
                  <i className="fas fa-exclamation-circle" style={{ marginRight: '4px' }}></i>
                  {errors.imageUrl}
                </div>
              )}
              <div className="form-hint">
                <i className="fas fa-info-circle" style={{ marginRight: '4px' }}></i>
                粘贴一张图片的链接（可选，最多一张）
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary">
              <i className="fas fa-check"></i>
              保存采样点
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ModalForm;
