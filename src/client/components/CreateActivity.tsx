import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

interface OptionInput {
  id: string;
  name: string;
  imageUrl: string;
  description: string;
}

interface CreateActivityProps {
  onActivityCreated: (activityId: string) => void;
}

const CreateActivity: React.FC<CreateActivityProps> = ({ onActivityCreated }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [time, setTime] = useState('');
  const [options, setOptions] = useState<OptionInput[]>([
    { id: uuidv4(), name: '', imageUrl: '', description: '' },
    { id: uuidv4(), name: '', imageUrl: '', description: '' }
  ]);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const addOption = () => {
    setOptions([...options, { id: uuidv4(), name: '', imageUrl: '', description: '' }]);
  };

  const removeOption = (id: string) => {
    if (options.length > 2) {
      setOptions(options.filter(opt => opt.id !== id));
    }
  };

  const updateOption = (id: string, field: keyof OptionInput, value: string) => {
    setOptions(options.map(opt => 
      opt.id === id ? { ...opt, [field]: value } : opt
    ));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const validOptions = options.filter(opt => opt.name.trim());
    if (validOptions.length < 2) {
      alert('请至少添加2个候选选项');
      return;
    }
    
    try {
      const response = await fetch('/api/activities', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          description,
          location,
          time,
          options: validOptions.map(({ id, ...rest }) => rest)
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        const fullShareLink = `${window.location.origin}/#/vote/${data.activity.id}`;
        setShareLink(fullShareLink);
        setTimeout(() => {
          onActivityCreated(data.activity.id);
        }, 3000);
      }
    } catch (error) {
      console.error('Failed to create activity:', error);
      alert('创建活动失败，请重试');
    }
  };

  const copyToClipboard = async () => {
    if (!shareLink) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(shareLink);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = shareLink;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      alert('复制失败，请手动复制链接');
    }
  };

  if (shareLink) {
    return (
      <div style={styles.container}>
        <div style={styles.successCard}>
          <div style={styles.successIcon}>✅</div>
          <h2 style={styles.successTitle}>活动创建成功！</h2>
          <p style={styles.successText}>正在跳转到管理页面...</p>
          
          <div style={styles.shareSection}>
            <label style={styles.shareLabel}>分享链接（参与者投票用）：</label>
            <div style={styles.linkContainer}>
              <input
                type="text"
                value={shareLink}
                readOnly
                style={styles.linkInput}
              />
              <button
                onClick={copyToClipboard}
                style={{
                  ...styles.copyButton,
                  backgroundColor: copied ? '#27ae60' : '#F5A623'
                }}
              >
                {copied ? '✓ 已复制' : '📋 复制链接'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>创建新活动</h1>
        
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.formGroup}>
            <label style={styles.label}>活动名称 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={styles.input}
              placeholder="例如：周末聚餐"
            />
          </div>
          
          <div style={styles.formGroup}>
            <label style={styles.label}>活动描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={styles.textarea}
              placeholder="简单描述一下这次活动..."
              rows={3}
            />
          </div>
          
          <div style={styles.row}>
            <div style={styles.formGroup}>
              <label style={styles.label}>地点 *</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                required
                style={styles.input}
                placeholder="例如：市中心"
              />
            </div>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>时间 *</label>
              <input
                type="datetime-local"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
                style={styles.input}
              />
            </div>
          </div>
          
          <div style={styles.optionsSection}>
            <div style={styles.optionsHeader}>
              <h3 style={styles.optionsTitle}>候选选项 *</h3>
              <button
                type="button"
                onClick={addOption}
                style={styles.addButton}
              >
                + 添加选项
              </button>
            </div>
            
            {options.map((option, index) => (
              <div key={option.id} style={styles.optionCard}>
                <div style={styles.optionHeader}>
                  <span style={styles.optionNumber}>选项 {index + 1}</span>
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOption(option.id)}
                      style={styles.removeButton}
                    >
                      × 删除
                    </button>
                  )}
                </div>
                
                <div style={styles.row}>
                  <div style={{ ...styles.formGroup, flex: 2 }}>
                    <label style={styles.label}>名称 *</label>
                    <input
                      type="text"
                      value={option.name}
                      onChange={(e) => updateOption(option.id, 'name', e.target.value)}
                      style={styles.input}
                      placeholder="例如：川菜馆"
                    />
                  </div>
                  
                  <div style={{ ...styles.formGroup, flex: 3 }}>
                    <label style={styles.label}>图片URL</label>
                    <input
                      type="url"
                      value={option.imageUrl}
                      onChange={(e) => updateOption(option.id, 'imageUrl', e.target.value)}
                      style={styles.input}
                      placeholder="https://example.com/image.jpg"
                    />
                  </div>
                </div>
                
                <div style={styles.formGroup}>
                  <label style={styles.label}>简介</label>
                  <textarea
                    value={option.description}
                    onChange={(e) => updateOption(option.id, 'description', e.target.value)}
                    style={styles.textarea}
                    placeholder="简短介绍这个选项..."
                    rows={2}
                  />
                </div>
              </div>
            ))}
          </div>
          
          <button type="submit" style={styles.submitButton}>
            创建活动
          </button>
        </form>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '20px'
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '20px',
    padding: '40px',
    boxShadow: '0 8px 30px rgba(0, 0, 0, 0.1)'
  },
  title: {
    fontSize: '32px',
    color: '#4A90D9',
    marginBottom: '32px',
    textAlign: 'center'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  label: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#333'
  },
  input: {
    padding: '12px 16px',
    border: '2px solid #e0e0e0',
    borderRadius: '10px',
    fontSize: '16px',
    transition: 'border-color 0.3s ease',
    outline: 'none'
  },
  textarea: {
    padding: '12px 16px',
    border: '2px solid #e0e0e0',
    borderRadius: '10px',
    fontSize: '16px',
    fontFamily: 'inherit',
    resize: 'vertical',
    transition: 'border-color 0.3s ease',
    outline: 'none'
  },
  row: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap'
  },
  optionsSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  optionsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  optionsTitle: {
    fontSize: '18px',
    color: '#333'
  },
  addButton: {
    backgroundColor: 'transparent',
    color: '#4A90D9',
    border: '2px solid #4A90D9',
    padding: '8px 16px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    transition: 'all 0.3s ease'
  },
  optionCard: {
    backgroundColor: '#f8fafc',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #e2e8f0'
  },
  optionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px'
  },
  optionNumber: {
    fontWeight: '600',
    color: '#4A90D9',
    fontSize: '14px'
  },
  removeButton: {
    backgroundColor: 'transparent',
    color: '#ef4444',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px'
  },
  submitButton: {
    backgroundColor: '#4A90D9',
    color: 'white',
    border: 'none',
    padding: '16px',
    fontSize: '18px',
    borderRadius: '12px',
    cursor: 'pointer',
    fontWeight: '600',
    transition: 'all 0.3s ease',
    boxShadow: '0 4px 15px rgba(74, 144, 217, 0.3)'
  },
  successCard: {
    backgroundColor: 'white',
    borderRadius: '20px',
    padding: '60px 40px',
    boxShadow: '0 8px 30px rgba(0, 0, 0, 0.1)',
    textAlign: 'center',
    maxWidth: '600px',
    margin: '0 auto'
  },
  successIcon: {
    fontSize: '64px',
    marginBottom: '16px'
  },
  successTitle: {
    fontSize: '28px',
    color: '#4A90D9',
    marginBottom: '8px'
  },
  successText: {
    color: '#666',
    marginBottom: '32px'
  },
  shareSection: {
    textAlign: 'left',
    marginTop: '24px'
  },
  shareLabel: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '600',
    color: '#333',
    marginBottom: '8px'
  },
  linkContainer: {
    display: 'flex',
    gap: '12px'
  },
  linkInput: {
    flex: 1,
    padding: '12px 16px',
    border: '2px solid #e0e0e0',
    borderRadius: '10px',
    fontSize: '14px',
    backgroundColor: '#f8fafc',
    fontFamily: 'monospace'
  },
  copyButton: {
    backgroundColor: '#F5A623',
    color: 'white',
    border: 'none',
    padding: '12px 24px',
    borderRadius: '10px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    whiteSpace: 'nowrap',
    transition: 'all 0.3s ease'
  }
};

export default CreateActivity;
