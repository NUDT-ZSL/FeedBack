import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface AdminProps {
  user: any;
  ws: WebSocket | null;
  onNotification: (message: string) => void;
}

const Admin: React.FC<AdminProps> = ({ user, ws, onNotification }) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'projects' | 'registrations'>('registrations');
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProject, setNewProject] = useState({
    name: '',
    description: '',
    location: '',
    serviceDate: '',
    startTime: '',
    endTime: '',
    maxVolunteers: 10,
    type: '环保' as '环保' | '教育' | '助老' | '社区',
    deadline: ''
  });

  useEffect(() => {
    if (user?.role !== 'admin') {
      navigate('/');
      return;
    }
    fetchRegistrations();
  }, [user, navigate]);

  useEffect(() => {
    if (ws) {
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'registration') {
          onNotification(`新报名：${message.data.user.nickname} 报名了 ${message.data.project.name}`);
          fetchRegistrations();
        }
      };
    }
  }, [ws, onNotification]);

  const fetchRegistrations = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/projects/admin/registrations', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setRegistrations(data);
    } catch (error) {
      console.error('获取报名列表失败:', error);
    }
  };

  const [approvingId, setApprovingId] = useState<string | null>(null);

  const handleApprove = async (regId: string, projectId: string, status: 'approved' | 'rejected') => {
    setApprovingId(regId);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${projectId}/registrations/${regId}/approve`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status })
      });

      if (response.ok) {
        onNotification(status === 'approved' ? '✅ 已通过报名申请' : '❌ 已拒绝报名申请');
        fetchRegistrations();
      } else {
        const data = await response.json();
        onNotification(`操作失败：${data.message || '未知错误'}`);
      }
    } catch (error) {
      console.error('审批失败:', error);
      onNotification('操作失败：网络错误');
    }
    setApprovingId(null);
  };

  const handleHoursSubmit = async (regId: string, projectId: string, hours: number) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${projectId}/registrations/${regId}/hours`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ hours })
      });

      if (response.ok) {
        fetchRegistrations();
      }
    } catch (error) {
      console.error('录入时长失败:', error);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newProject)
      });

      if (response.ok) {
        setShowCreateForm(false);
        setNewProject({
          name: '',
          description: '',
          location: '',
          serviceDate: '',
          startTime: '',
          endTime: '',
          maxVolunteers: 10,
          type: '环保',
          deadline: ''
        });
        onNotification('项目创建成功');
      }
    } catch (error) {
      console.error('创建项目失败:', error);
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return '待审核';
      case 'approved': return '已通过';
      case 'rejected': return '已拒绝';
      default: return status;
    }
  };

  if (user?.role !== 'admin') {
    return null;
  }

  return (
    <div className="page-container">
      <h1 className="page-title">后台管理</h1>
      
      <div className="tabs">
        <button 
          className={`tab-btn ${activeTab === 'registrations' ? 'active' : ''}`}
          onClick={() => setActiveTab('registrations')}
        >
          报名管理
        </button>
        <button 
          className={`tab-btn ${activeTab === 'projects' ? 'active' : ''}`}
          onClick={() => setActiveTab('projects')}
        >
          项目管理
        </button>
      </div>

      {activeTab === 'registrations' && (
        <div className="dashboard-section">
          <h3>报名审核</h3>
          {registrations.length > 0 ? (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>志愿者</th>
                  <th>项目名称</th>
                  <th>项目类型</th>
                  <th>报名备注</th>
                  <th>状态</th>
                  <th>服务时长</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {registrations.map((reg) => (
                  <tr key={reg.id}>
                    <td>{reg.userNickname}</td>
                    <td>{reg.projectName}</td>
                    <td>{reg.projectType}</td>
                    <td style={{ maxWidth: '200px' }}>{reg.remark || '-'}</td>
                    <td>
                      <span className={`status-badge status-${reg.status}`}>
                        {getStatusText(reg.status)}
                      </span>
                    </td>
                    <td>
                      {reg.status === 'approved' ? (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <input
                            type="number"
                            defaultValue={reg.serviceHours || 0}
                            min="0"
                            max="24"
                            style={{ width: '60px', padding: '4px 8px' }}
                            onBlur={(e) => handleHoursSubmit(reg.id, reg.projectId, Number(e.target.value))}
                          />
                          <span>小时</span>
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      {reg.status === 'pending' && (
                        <div className="admin-actions">
                          <button
                            className="btn btn-sm btn-success"
                            onClick={() => handleApprove(reg.id, reg.projectId, 'approved')}
                            disabled={approvingId === reg.id}
                          >
                            {approvingId === reg.id ? '...' : '通过'}
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => handleApprove(reg.id, reg.projectId, 'rejected')}
                            disabled={approvingId === reg.id}
                          >
                            {approvingId === reg.id ? '...' : '拒绝'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">暂无报名记录</div>
          )}
        </div>
      )}

      {activeTab === 'projects' && (
        <div className="dashboard-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ marginBottom: 0 }}>创建新项目</h3>
            <button className="btn" onClick={() => setShowCreateForm(!showCreateForm)}>
              {showCreateForm ? '取消' : '+ 创建项目'}
            </button>
          </div>
          
          {showCreateForm && (
            <form onSubmit={handleCreateProject}>
              <div className="form-row">
                <div className="form-group">
                  <label>项目名称</label>
                  <input
                    type="text"
                    value={newProject.name}
                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>项目类型</label>
                  <select
                    value={newProject.type}
                    onChange={(e) => setNewProject({ ...newProject, type: e.target.value as any })}
                  >
                    <option value="环保">环保</option>
                    <option value="教育">教育</option>
                    <option value="助老">助老</option>
                    <option value="社区">社区</option>
                  </select>
                </div>
              </div>
              
              <div className="form-group">
                <label>项目描述</label>
                <textarea
                  value={newProject.description}
                  onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                  rows={3}
                  required
                />
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>服务地点</label>
                  <input
                    type="text"
                    value={newProject.location}
                    onChange={(e) => setNewProject({ ...newProject, location: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>所需志愿者人数（1-20）</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={newProject.maxVolunteers}
                    onChange={(e) => setNewProject({ ...newProject, maxVolunteers: Number(e.target.value) })}
                    required
                  />
                </div>
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>服务日期</label>
                  <input
                    type="date"
                    value={newProject.serviceDate}
                    onChange={(e) => setNewProject({ ...newProject, serviceDate: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>报名截止日期</label>
                  <input
                    type="date"
                    value={newProject.deadline}
                    onChange={(e) => setNewProject({ ...newProject, deadline: e.target.value })}
                    required
                  />
                </div>
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>开始时间</label>
                  <input
                    type="time"
                    value={newProject.startTime}
                    onChange={(e) => setNewProject({ ...newProject, startTime: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>结束时间</label>
                  <input
                    type="time"
                    value={newProject.endTime}
                    onChange={(e) => setNewProject({ ...newProject, endTime: e.target.value })}
                    required
                  />
                </div>
              </div>
              
              <button type="submit" className="btn btn-block">
                创建项目
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
};

export default Admin;
