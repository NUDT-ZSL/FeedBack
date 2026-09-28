import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';

interface ProjectDetailProps {
  user: any;
  ws: WebSocket | null;
  onNotification?: (message: string) => void;
}

const ProjectDetail: React.FC<ProjectDetailProps> = ({ user, ws, onNotification }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [remark, setRemark] = useState('');
  const [registerStatus, setRegisterStatus] = useState<string>('');
  const [registerStatusType, setRegisterStatusType] = useState<'success' | 'error' | 'info'>('info');
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const rippleRef = useRef<HTMLButtonElement>(null);

  const fetchProject = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${id}`);
      const data = await response.json();
      setProject(data);
    } catch (error) {
      console.error('获取项目详情失败:', error);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  useEffect(() => {
    if (ws) {
      const handleMessage = (event: MessageEvent) => {
        const message = JSON.parse(event.data);
        if (message.type === 'approval' && message.data.projectId === id) {
          fetchProject();
          if (onNotification) {
            const statusText = message.data.status === 'approved' ? '已通过' : '已拒绝';
            onNotification(`您的报名申请${statusText}`);
          }
        }
      };
      ws.addEventListener('message', handleMessage);
      return () => ws.removeEventListener('message', handleMessage);
    }
  }, [ws, id, fetchProject, onNotification]);

  const createRipple = (e: React.MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget;
    const ripple = document.createElement('span');
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;
    
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    ripple.classList.add('btn-ripple');
    button.appendChild(ripple);
    
    setTimeout(() => ripple.remove(), 600);
  };

  const handleRegister = async (e: React.MouseEvent<HTMLButtonElement>) => {
    createRipple(e);
    
    if (!user) {
      navigate('/login');
      return;
    }

    if (!showRegisterForm) {
      setShowRegisterForm(true);
      setRegisterStatus('');
      return;
    }

    setSubmitting(true);
    setRegisterStatus('');

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${id}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ remark })
      });

      const data = await response.json();

      if (response.ok) {
        setRegisterStatus('✅ 报名成功！请等待管理员审核');
        setRegisterStatusType('success');
        setShowRegisterForm(false);
        setRemark('');
        fetchProject();
      } else {
        setRegisterStatus(`❌ ${data.message || '报名失败'}`);
        setRegisterStatusType('error');
      }
    } catch (error) {
      setRegisterStatus('❌ 网络错误，请稍后重试');
      setRegisterStatusType('error');
    }

    setSubmitting(false);
  };

  if (loading) {
    return <div className="loading-more">加载中...</div>;
  }

  if (!project) {
    return <div className="empty-state">项目不存在</div>;
  }

  const isExpired = new Date(project.deadline) < new Date();

  return (
    <div className="page-container">
      <Link to="/projects" className="back-link">← 返回项目列表</Link>
      
      <div className="detail-container">
        <div className="detail-header">
          <span className={`project-type-tag type-${project.type}`}>{project.type}</span>
          <h2>{project.name}</h2>
          <div style={{ display: 'flex', gap: '20px', color: '#666', fontSize: '14px' }}>
            <span>📍 {project.location}</span>
            <span>👥 已报名 {project.registeredCount}/{project.maxVolunteers} 人</span>
          </div>
        </div>

        <div className="detail-info">
          <div className="info-item">
            <span className="info-label">服务日期</span>
            <span className="info-value">{project.serviceDate}</span>
          </div>
          <div className="info-item">
            <span className="info-label">服务时间</span>
            <span className="info-value">{project.startTime} - {project.endTime}</span>
          </div>
          <div className="info-item">
            <span className="info-label">报名截止</span>
            <span className="info-value" style={{ color: isExpired ? '#95a5a6' : '#e74c3c' }}>
              {project.deadline} {isExpired && '(已截止)'}
            </span>
          </div>
          <div className="info-item">
            <span className="info-label">剩余名额</span>
            <span className="info-value" style={{ color: '#A23B72' }}>
              {project.remainingSlots} 个
            </span>
          </div>
        </div>

        <div className="detail-description">
          <h3 style={{ marginBottom: '12px', color: '#333' }}>项目描述</h3>
          <p>{project.description}</p>
        </div>

        <div className="registration-section">
          <h3>我要报名</h3>
          {isExpired ? (
            <p style={{ color: '#95a5a6', fontSize: '16px' }}>⏰ 报名已截止</p>
          ) : project.remainingSlots <= 0 ? (
            <p style={{ color: '#e74c3c', fontSize: '16px' }}>😢 名额已满</p>
          ) : (
            <>
              {!showRegisterForm ? (
                <button
                  ref={rippleRef}
                  className="btn"
                  onClick={handleRegister}
                >
                  {user ? '✨ 立即报名' : '🔐 登录后报名'}
                </button>
              ) : (
                <div>
                  <div className="form-group">
                    <label>报名备注</label>
                    <textarea
                      value={remark}
                      onChange={(e) => setRemark(e.target.value)}
                      placeholder="请填写报名备注（选填），例如：相关经验、特殊需求等"
                      rows={3}
                    />
                  </div>
                  <button
                    ref={rippleRef}
                    className="btn"
                    onClick={handleRegister}
                    disabled={submitting}
                  >
                    {submitting ? '提交中...' : '✅ 提交报名'}
                  </button>
                </div>
              )}
              {registerStatus && (
                <div style={{
                  marginTop: '16px',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  backgroundColor: registerStatusType === 'success' ? '#d1fae5' : registerStatusType === 'error' ? '#fee2e2' : '#fef3c7',
                  color: registerStatusType === 'success' ? '#059669' : registerStatusType === 'error' ? '#dc2626' : '#d97706',
                  fontSize: '14px',
                  fontWeight: '500'
                }}>
                  {registerStatus}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <h3 style={{ marginBottom: '16px' }}>已报名志愿者 ({project.registeredVolunteers?.length || 0})</h3>
          {project.registeredVolunteers?.length > 0 ? (
            <div className="volunteers-list">
              {project.registeredVolunteers.map((volunteer: any) => (
                <div key={volunteer.id} className="volunteer-item">
                  <div className="volunteer-avatar">
                    {volunteer.nickname?.charAt(0) || 'V'}
                  </div>
                  <span className="volunteer-name">{volunteer.nickname}</span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: '#999' }}>暂无报名志愿者</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectDetail;
