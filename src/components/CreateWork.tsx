import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FaArrowLeft, FaPlus, FaTrash, FaImage } from 'react-icons/fa';
import { Category, WorkStep, categoryConfig } from '../types';
import { useRipple } from '../hooks/useRipple';

interface CreateWorkProps {
  onCreateWork: (work: {
    name: string;
    category: Category;
    steps: WorkStep[];
  }) => void;
}

const placeholderImages = [
  'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=400&h=300&fit=crop',
  'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=400&h=300&fit=crop',
  'https://images.unsplash.com/photo-1610701596037-354999918420?w=400&h=300&fit=crop',
  'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=300&fit=crop',
  'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&h=300&fit=crop',
];

const generateId = () => Math.random().toString(36).substring(2, 9);

export const CreateWork: React.FC<CreateWorkProps> = ({ onCreateWork }) => {
  const navigate = useNavigate();
  const createRipple = useRipple('rgba(62, 39, 35, 0.3)');

  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('ceramic');
  const [steps, setSteps] = useState<WorkStep[]>([
    {
      id: generateId(),
      order: 1,
      image: placeholderImages[0],
      description: '',
      duration: 30,
    },
    {
      id: generateId(),
      order: 2,
      image: placeholderImages[1],
      description: '',
      duration: 30,
    },
    {
      id: generateId(),
      order: 3,
      image: placeholderImages[2],
      description: '',
      duration: 30,
    },
  ]);
  const [draggedStep, setDraggedStep] = useState<string | null>(null);

  const handleAddStep = () => {
    if (steps.length >= 10) {
      toast.error('最多添加10个步骤');
      return;
    }
    const newStep: WorkStep = {
      id: generateId(),
      order: steps.length + 1,
      image: placeholderImages[steps.length % placeholderImages.length],
      description: '',
      duration: 30,
    };
    setSteps([...steps, newStep]);
    toast.success('已添加新步骤');
  };

  const handleRemoveStep = (stepId: string) => {
    if (steps.length <= 3) {
      toast.error('至少需要3个步骤');
      return;
    }
    const newSteps = steps
      .filter(s => s.id !== stepId)
      .map((s, i) => ({ ...s, order: i + 1 }));
    setSteps(newSteps);
    toast.success('已删除步骤');
  };

  const handleUpdateStep = (stepId: string, field: keyof WorkStep, value: string | number) => {
    setSteps(steps.map(s =>
      s.id === stepId ? { ...s, [field]: value } : s
    ));
  };

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
  };

  const handleDragEnd = () => {
    setDraggedStep(null);
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error('请输入作品名称');
      return;
    }

    const invalidSteps = steps.filter(s => !s.description.trim() || s.duration <= 0);
    if (invalidSteps.length > 0) {
      toast.error('请填写所有步骤的描述和有效耗时');
      return;
    }

    if (steps.some(s => s.description.length > 200)) {
      toast.error('步骤描述不能超过200字');
      return;
    }

    onCreateWork({
      name: name.trim(),
      category,
      steps,
    });

    toast.success('作品创建成功！');
    setTimeout(() => navigate('/'), 500);
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

      <h1 style={{ fontSize: '32px', marginBottom: '32px' }}>创建新作品</h1>

      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--shadow-card)',
          padding: 'var(--padding-card)',
          marginBottom: '32px',
        }}
      >
        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-title)', fontSize: '16px', fontWeight: 500 }}>
            作品名称
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="请输入作品名称"
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: '12px',
              border: '2px solid #E0E0E0',
              fontSize: '16px',
              outline: 'none',
              transition: 'border-color 0.2s var(--easing-standard)',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = categoryConfig[category].color;
            }}
            onBlur={(e) => {
              e.target.style.borderColor = '#E0E0E0';
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '12px', color: 'var(--text-title)', fontSize: '16px', fontWeight: 500 }}>
            作品类别
          </label>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {(Object.keys(categoryConfig) as Category[]).map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                style={{
                  padding: '8px 20px',
                  borderRadius: '20px',
                  border: category === cat ? `2px solid ${categoryConfig[cat].color}` : '2px solid transparent',
                  backgroundColor: category === cat ? categoryConfig[cat].color : '#F5F5F5',
                  color: category === cat
                    ? (cat === 'paper' ? '#5D4037' : '#FFFFFF')
                    : 'var(--text-body)',
                  fontSize: '14px',
                  fontWeight: 500,
                  transition: 'transform 0.2s var(--easing-standard), box-shadow 0.2s var(--easing-standard)',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                {categoryConfig[cat].name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '24px' }}>制作步骤</h2>
        <button
          className="ripple-container"
          onClick={(e) => {
            createRipple(e);
            handleAddStep();
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px',
            backgroundColor: categoryConfig[category].color,
            color: category === 'paper' ? '#5D4037' : '#FFFFFF',
            borderRadius: '12px',
            fontSize: '14px',
            fontWeight: 500,
            transition: 'transform 0.2s var(--easing-standard), box-shadow 0.2s var(--easing-standard)',
            boxShadow: `0 4px 12px ${categoryConfig[category].color}66`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = `0 6px 20px ${categoryConfig[category].color}99`;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = `0 4px 12px ${categoryConfig[category].color}66`;
          }}
        >
          <FaPlus size={14} />
          添加步骤
        </button>
      </div>

      <div style={{ marginBottom: '32px' }}>
        {steps.map((step, index) => (
          <div key={step.id} style={{ position: 'relative', marginBottom: index < steps.length - 1 ? '40px' : '0' }}>
            <div
              draggable
              onDragStart={(e) => handleDragStart(e, step.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, step.id)}
              onDragEnd={handleDragEnd}
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 'var(--radius-card)',
                boxShadow: draggedStep === step.id
                  ? '0 16px 48px rgba(0,0,0,0.2)'
                  : 'var(--shadow-card)',
                padding: 'var(--padding-card)',
                transform: draggedStep === step.id ? 'rotate(2deg) scale(1.05)' : 'none',
                transition: 'transform 0.2s var(--easing-standard), box-shadow 0.2s var(--easing-standard)',
                cursor: 'grab',
                position: 'relative',
                zIndex: draggedStep === step.id ? 10 : 1,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      backgroundColor: categoryConfig[category].color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: category === 'paper' ? '#5D4037' : '#FFFFFF',
                      fontWeight: 600,
                      fontSize: '16px',
                    }}
                  >
                    {step.order}
                  </div>
                  <span style={{ fontWeight: 500, color: 'var(--text-title)' }}>
                    步骤 {step.order}
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveStep(step.id);
                  }}
                  style={{
                    padding: '8px',
                    color: '#E53935',
                    borderRadius: '8px',
                    transition: 'background-color 0.2s var(--easing-standard)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#FFEBEE';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <FaTrash size={16} />
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <FaImage size={16} style={{ color: 'var(--text-muted)' }} />
                  <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                    步骤图片:
                  </span>
                  <input
                    type="text"
                    value={step.image}
                    onChange={(e) => handleUpdateStep(step.id, 'image', e.target.value)}
                    placeholder="图片URL"
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid #E0E0E0',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>

                <img
                  src={step.image}
                  alt={`步骤 ${step.order} 预览`}
                  style={{
                    width: '100%',
                    height: '150px',
                    objectFit: 'cover',
                    borderRadius: '12px',
                  }}
                />

                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-muted)' }}>
                    步骤描述 ({step.description.length}/200)
                  </label>
                  <textarea
                    value={step.description}
                    onChange={(e) => handleUpdateStep(step.id, 'description', e.target.value.slice(0, 200))}
                    placeholder="请描述这一步的制作过程..."
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      borderRadius: '12px',
                      border: '2px solid #E0E0E0',
                      fontSize: '15px',
                      resize: 'vertical',
                      minHeight: '80px',
                      outline: 'none',
                      transition: 'border-color 0.2s var(--easing-standard)',
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = categoryConfig[category].color;
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = '#E0E0E0';
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-muted)' }}>
                    耗时 (分钟)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={step.duration}
                    onChange={(e) => handleUpdateStep(step.id, 'duration', parseInt(e.target.value) || 1)}
                    style={{
                      width: '120px',
                      padding: '10px 16px',
                      borderRadius: '12px',
                      border: '2px solid #E0E0E0',
                      fontSize: '15px',
                      outline: 'none',
                      transition: 'border-color 0.2s var(--easing-standard)',
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = categoryConfig[category].color;
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = '#E0E0E0';
                    }}
                  />
                </div>
              </div>
            </div>

            {index < steps.length - 1 && (
              <div
                style={{
                  position: 'absolute',
                  left: '42px',
                  top: '100%',
                  width: '2px',
                  height: '40px',
                  backgroundImage: 'radial-gradient(circle, var(--connector-color) 1px, transparent 1px)',
                  backgroundSize: '2px 8px',
                }}
              />
            )}
          </div>
        ))}
      </div>

      <button
        className="ripple-container"
        onClick={(e) => {
          createRipple(e);
          handleSubmit();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          width: '100%',
          padding: '16px',
          backgroundColor: 'var(--text-title)',
          color: '#FFFFFF',
          borderRadius: 'var(--radius-card)',
          fontSize: '18px',
          fontWeight: 600,
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
        创建作品
      </button>
    </div>
  );
};
