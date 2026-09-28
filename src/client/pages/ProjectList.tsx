import React, { useState, useEffect, useRef, useCallback } from 'react';
import ProjectCard from '../components/ProjectCard';

const ProjectList: React.FC = () => {
  const [projects, setProjects] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const observer = useRef<IntersectionObserver | null>(null);
  const lastProjectRef = useCallback((node: HTMLDivElement | null) => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        setPage(prev => prev + 1);
      }
    });
    if (node) observer.current.observe(node);
  }, [loading, hasMore]);

  const loadProjects = useCallback(async (pageNum: number, reset: boolean = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pageNum),
        limit: '20',
        ...(search && { search }),
        ...(typeFilter && { type: typeFilter }),
        ...(dateFrom && { dateFrom }),
        ...(dateTo && { dateTo })
      });
      
      const response = await fetch(`/api/projects?${params}`);
      const data = await response.json();
      
      if (reset) {
        setProjects(data.projects);
      } else {
        setProjects(prev => [...prev, ...data.projects]);
      }
      setHasMore(data.hasMore);
    } catch (error) {
      console.error('加载项目失败:', error);
    }
    setLoading(false);
  }, [search, typeFilter, dateFrom, dateTo]);

  useEffect(() => {
    setProjects([]);
    setPage(1);
    setHasMore(true);
  }, [search, typeFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (page === 1 || projects.length > 0) {
      loadProjects(page, page === 1);
    }
  }, [page, search, typeFilter, dateFrom, dateTo]);

  const typeOptions = ['环保', '教育', '助老', '社区'];

  const handleTypeClick = (type: string) => {
    setTypeFilter(typeFilter === type ? '' : type);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setTimeout(() => setSearch(value), 300);
  };

  return (
    <div className="page-container">
      <h1 className="page-title">志愿服务项目</h1>
      
      <div className="filter-bar">
        <input
          type="text"
          placeholder="🔍 搜索项目名称、地点..."
          onChange={handleSearchChange}
        />
        <div className="type-tags">
          {typeOptions.map(type => (
            <button
              key={type}
              className={`type-tag-btn ${typeFilter === type ? 'active' : ''}`}
              onClick={() => handleTypeClick(type)}
            >
              {type}
            </button>
          ))}
        </div>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          placeholder="开始日期"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          placeholder="结束日期"
        />
      </div>

      <div className="projects-grid">
        {projects.map((project, index) => {
          if (projects.length === index + 1) {
            return (
              <div ref={lastProjectRef} key={project.id}>
                <ProjectCard project={project} />
              </div>
            );
          }
          return <ProjectCard key={project.id} project={project} />;
        })}
      </div>

      {loading && <div className="loading-more">加载中...</div>}
      
      {!loading && projects.length === 0 && (
        <div className="empty-state">暂无相关项目</div>
      )}
      
      {!hasMore && projects.length > 0 && (
        <div className="loading-more">已加载全部项目</div>
      )}
      
      <div className="sentinel" ref={lastProjectRef as any}></div>
    </div>
  );
};

export default ProjectList;
