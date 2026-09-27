import { useState, useEffect, useCallback } from 'react';
import Timeline from './components/Timeline';
import DetailPanel from './components/DetailPanel';
import {
  fetchEventList,
  addEvent as apiAddEvent,
  filterEvents,
  exportMarkdown as apiExportMarkdown,
} from './api/travelApi';
import type { TravelEvent, FilterParams } from './api/travelApi';

const AVAILABLE_TAGS = ['美食', '风景', '人文'];

export default function App() {
  const [events, setEvents] = useState<TravelEvent[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<TravelEvent[]>([]);
  const [filter, setFilter] = useState<FilterParams>({});
  const [selectedEvent, setSelectedEvent] = useState<TravelEvent | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [exportSelectedIds, setExportSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newEvent, setNewEvent] = useState({
    date: new Date().toISOString().slice(0, 10),
    location: '',
    country: '',
    description: '',
    tags: [] as string[],
    images: [] as string[],
    newImageUrl: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const [toast, setToast] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportResult, setExportResult] = useState<{
    markdown: string;
    filename: string;
  } | null>(null);
  const [exportLoading, setExportLoading] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1500);
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchEventList();
      setEvents(data);
      setFilteredEvents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const applyFilter = useCallback(
    async (params: FilterParams) => {
      try {
        setLoading(true);
        setError(null);
        if (!params.year && !params.country && !params.tag) {
          const data = await fetchEventList();
          setFilteredEvents(data);
        } else {
          const data = await filterEvents(params);
          setFilteredEvents(data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '筛选失败');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const handleFilterChange = (params: FilterParams) => {
    setFilter(params);
    applyFilter(params);
  };

  const handleClearFilter = () => {
    setFilter({});
    applyFilter({});
  };

  const handleDoubleClick = (event: TravelEvent) => {
    setSelectedEvent(event);
    setDetailOpen(true);
  };

  const handleCloseDetail = () => {
    setDetailOpen(false);
    setTimeout(() => setSelectedEvent(null), 400);
  };

  const toggleExportSelect = (id: string) => {
    setExportSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleTag = (tag: string) => {
    setNewEvent((prev) => ({
      ...prev,
      tags: prev.tags.includes(tag)
        ? prev.tags.filter((t) => t !== tag)
        : [...prev.tags, tag],
    }));
  };

  const addImageUrl = () => {
    if (!newEvent.newImageUrl.trim()) return;
    if (newEvent.images.length >= 3) {
      showToast('最多只能添加3张图片');
      return;
    }
    setNewEvent((prev) => ({
      ...prev,
      images: [...prev.images, prev.newImageUrl.trim()],
      newImageUrl: '',
    }));
  };

  const removeImage = (index: number) => {
    setNewEvent((prev) => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index),
    }));
  };

  const handleLocalFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const remaining = 3 - newEvent.images.length;
    if (remaining <= 0) {
      showToast('最多只能添加3张图片');
      return;
    }
    const toRead = Array.from(files).slice(0, remaining);
    toRead.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        setNewEvent((prev) => ({
          ...prev,
          images: [...prev.images, result].slice(0, 3),
        }));
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const resetAddForm = () => {
    setNewEvent({
      date: new Date().toISOString().slice(0, 10),
      location: '',
      country: '',
      description: '',
      tags: [],
      images: [],
      newImageUrl: '',
    });
  };

  const handleSubmitNewEvent = async () => {
    if (!newEvent.location.trim()) {
      showToast('请填写地点名称');
      return;
    }
    if (!newEvent.country.trim()) {
      showToast('请填写国家');
      return;
    }
    if (!newEvent.description.trim()) {
      showToast('请填写描述');
      return;
    }
    try {
      setSubmitting(true);
      const created = await apiAddEvent({
        date: newEvent.date,
        location: newEvent.location.trim(),
        country: newEvent.country.trim(),
        description: newEvent.description.trim(),
        tags: newEvent.tags,
        images: newEvent.images,
      });
      setEvents((prev) =>
        [...prev, created].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        )
      );
      if (filter.year || filter.country || filter.tag) {
        applyFilter(filter);
      } else {
        setFilteredEvents((prev) =>
          [...prev, created].sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
          )
        );
      }
      showToast('添加成功！');
      setShowAddModal(false);
      resetAddForm();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '添加失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExport = async () => {
    try {
      setExportLoading(true);
      setError(null);
      const idsToExport =
        exportSelectedIds.length > 0
          ? exportSelectedIds
          : filteredEvents.map((e) => e.id);
      const result = await apiExportMarkdown(idsToExport);
      setExportResult(result);
      setShowExportModal(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExportLoading(false);
    }
  };

  const downloadMarkdown = () => {
    if (!exportResult) return;
    const blob = new Blob([exportResult.markdown], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportResult.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('已开始下载');
  };

  return (
    <div style={{ minHeight: '100vh', background: '#F5F0EB' }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 150,
          height: '60px',
          background: '#2D2D2D',
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#4A90D9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L13.09 8.26L20 9.27L15 14.14L16.18 21.02L12 17.77L7.82 21.02L9 14.14L4 9.27L10.91 8.26L12 2Z" />
          </svg>
          <h1
            style={{
              color: '#FFFFFF',
              fontSize: '24px',
              fontWeight: 700,
              letterSpacing: '0.5px',
            }}
          >
            我的时间线
          </h1>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {exportSelectedIds.length > 0 && (
            <span
              style={{
                color: '#fff',
                fontSize: '13px',
                padding: '4px 12px',
                background: 'rgba(74, 144, 217, 0.3)',
                borderRadius: '12px',
              }}
            >
              已选 {exportSelectedIds.length} 个
            </span>
          )}
          <button
            onClick={handleExport}
            disabled={exportLoading || filteredEvents.length === 0}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              background: exportLoading || filteredEvents.length === 0
                ? 'rgba(255,255,255,0.2)'
                : 'rgba(255,255,255,0.15)',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s',
              cursor: exportLoading || filteredEvents.length === 0 ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (!exportLoading && filteredEvents.length > 0) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.25)';
              }
            }}
            onMouseLeave={(e) => {
              if (!exportLoading && filteredEvents.length > 0) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
              }
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {exportLoading ? '导出中...' : '导出 Markdown'}
          </button>
        </div>
      </header>

      {error && (
        <div
          style={{
            position: 'fixed',
            top: '72px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#FFEBEE',
            color: '#C62828',
            padding: '10px 20px',
            borderRadius: '8px',
            fontSize: '13px',
            zIndex: 200,
            border: '1px solid #FFCDD2',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span>⚠️ {error}</span>
          <button
            onClick={() => setError(null)}
            style={{ color: '#C62828', fontSize: '16px', marginLeft: '8px' }}
          >
            ✕
          </button>
        </div>
      )}

      {loading && events.length === 0 ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 'calc(100vh - 60px)',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                border: '4px solid #E8E0D8',
                borderTopColor: '#4A90D9',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
                margin: '0 auto 16px',
              }}
            />
            <p style={{ color: '#666', fontSize: '14px' }}>正在加载旅行记忆...</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      ) : (
        <Timeline
          events={filteredEvents}
          selectedEventId={selectedEvent?.id || null}
          exportSelectedIds={exportSelectedIds}
          onToggleExportSelect={toggleExportSelect}
          onEventDoubleClick={handleDoubleClick}
          onAddEvent={() => setShowAddModal(true)}
          onFilterChange={handleFilterChange}
          currentFilter={filter}
          onClearFilter={handleClearFilter}
        />
      )}

      <DetailPanel
        event={selectedEvent}
        isOpen={detailOpen}
        onClose={handleCloseDetail}
        onShowToast={showToast}
      />

      {showAddModal && (
        <>
          <div
            onClick={() => {
              setShowAddModal(false);
              resetAddForm();
            }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              zIndex: 300,
              animation: 'fadeIn 0.3s',
            }}
          />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '90%',
              maxWidth: '560px',
              maxHeight: '90vh',
              background: '#fff',
              borderRadius: '16px',
              zIndex: 301,
              animation: 'modalIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
            }}
          >
            <div
              style={{
                padding: '20px 24px',
                borderBottom: '1px solid #E8E0D8',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#333' }}>
                ✨ 添加新的旅行记忆
              </h2>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  resetAddForm();
                }}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  color: '#666',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#F5F0EB')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#666', marginBottom: '6px' }}>
                  📅 日期 *
                </label>
                <input
                  type="date"
                  value={newEvent.date}
                  onChange={(e) => setNewEvent((p) => ({ ...p, date: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    border: '1px solid #E8E0D8',
                    borderRadius: '10px',
                    fontSize: '14px',
                    color: '#333',
                    transition: 'border-color 0.2s',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#666', marginBottom: '6px' }}>
                    📍 地点 *
                  </label>
                  <input
                    type="text"
                    placeholder="例如：西湖"
                    value={newEvent.location}
                    onChange={(e) => setNewEvent((p) => ({ ...p, location: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      border: '1px solid #E8E0D8',
                      borderRadius: '10px',
                      fontSize: '14px',
                      color: '#333',
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#666', marginBottom: '6px' }}>
                    🌏 国家 *
                  </label>
                  <input
                    type="text"
                    placeholder="例如：中国"
                    value={newEvent.country}
                    onChange={(e) => setNewEvent((p) => ({ ...p, country: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      border: '1px solid #E8E0D8',
                      borderRadius: '10px',
                      fontSize: '14px',
                      color: '#333',
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#666', marginBottom: '8px' }}>
                  🏷️ 标签
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {AVAILABLE_TAGS.map((tag) => {
                    const active = newEvent.tags.includes(tag);
                    return (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        style={{
                          padding: '6px 16px',
                          borderRadius: '18px',
                          fontSize: '13px',
                          fontWeight: 500,
                          border: '1.5px solid',
                          borderColor: active ? '#4A90D9' : '#E8E0D8',
                          background: active ? '#4A90D9' : '#fff',
                          color: active ? '#fff' : '#555',
                          transition: 'all 0.2s',
                        }}
                      >
                        #{tag}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#666', marginBottom: '6px' }}>
                  📝 描述 *
                </label>
                <textarea
                  rows={4}
                  placeholder="记录这次旅行的难忘经历..."
                  value={newEvent.description}
                  onChange={(e) => setNewEvent((p) => ({ ...p, description: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    border: '1px solid #E8E0D8',
                    borderRadius: '10px',
                    fontSize: '14px',
                    color: '#333',
                    resize: 'vertical',
                    lineHeight: 1.6,
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#666', marginBottom: '8px' }}>
                  🖼️ 图片（最多3张）
                </label>
                {newEvent.images.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '10px' }}>
                    {newEvent.images.map((img, idx) => (
                      <div
                        key={idx}
                        style={{
                          position: 'relative',
                          paddingTop: '100%',
                          borderRadius: '10px',
                          overflow: 'hidden',
                          background: '#E8E0D8',
                        }}
                      >
                        <img
                          src={img}
                          alt={`预览${idx + 1}`}
                          style={{
                            position: 'absolute',
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          }}
                        />
                        <button
                          onClick={() => removeImage(idx)}
                          style={{
                            position: 'absolute',
                            top: '4px',
                            right: '4px',
                            width: '22px',
                            height: '22px',
                            borderRadius: '50%',
                            background: 'rgba(0,0,0,0.6)',
                            color: '#fff',
                            fontSize: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {newEvent.images.length < 3 && (
                  <>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <input
                        type="text"
                        placeholder="输入图片URL..."
                        value={newEvent.newImageUrl}
                        onChange={(e) => setNewEvent((p) => ({ ...p, newImageUrl: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addImageUrl();
                          }
                        }}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          border: '1px solid #E8E0D8',
                          borderRadius: '8px',
                          fontSize: '13px',
                        }}
                      />
                      <button
                        onClick={addImageUrl}
                        style={{
                          padding: '8px 14px',
                          borderRadius: '8px',
                          background: '#4A90D9',
                          color: '#fff',
                          fontSize: '13px',
                          fontWeight: 600,
                          transition: 'background 0.2s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#3A7BC8')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = '#4A90D9')}
                      >
                        添加
                      </button>
                    </div>
                    <label
                      style={{
                        display: 'block',
                        padding: '12px',
                        border: '2px dashed #C8BEB5',
                        borderRadius: '10px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        fontSize: '13px',
                        color: '#666',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#4A90D9';
                        e.currentTarget.style.color = '#4A90D9';
                        e.currentTarget.style.background = '#F0F6FC';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#C8BEB5';
                        e.currentTarget.style.color = '#666';
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      📤 点击上传本地图片
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleLocalFile}
                        style={{ display: 'none' }}
                      />
                    </label>
                  </>
                )}
              </div>
            </div>

            <div
              style={{
                padding: '16px 24px',
                borderTop: '1px solid #E8E0D8',
                display: 'flex',
                gap: '12px',
                justifyContent: 'flex-end',
                flexShrink: 0,
              }}
            >
              <button
                onClick={() => {
                  setShowAddModal(false);
                  resetAddForm();
                }}
                style={{
                  padding: '10px 20px',
                  borderRadius: '10px',
                  background: '#F5F0EB',
                  color: '#555',
                  fontSize: '14px',
                  fontWeight: 600,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#E8E0D8')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#F5F0EB')}
              >
                取消
              </button>
              <button
                onClick={handleSubmitNewEvent}
                disabled={submitting}
                style={{
                  padding: '10px 24px',
                  borderRadius: '10px',
                  background: submitting ? '#A8C8E8' : '#4A90D9',
                  color: '#fff',
                  fontSize: '14px',
                  fontWeight: 600,
                  transition: 'all 0.2s',
                  boxShadow: '0 2px 8px rgba(74, 144, 217, 0.3)',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={(e) => {
                  if (!submitting) {
                    e.currentTarget.style.background = '#3A7BC8';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!submitting) {
                    e.currentTarget.style.background = '#4A90D9';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }
                }}
              >
                {submitting ? '保存中...' : '保存记忆'}
              </button>
            </div>
          </div>
        </>
      )}

      {showExportModal && exportResult && (
        <>
          <div
            onClick={() => {
              setShowExportModal(false);
              setExportResult(null);
            }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              zIndex: 300,
              animation: 'fadeIn 0.3s',
            }}
          />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '90%',
              maxWidth: '680px',
              maxHeight: '85vh',
              background: '#fff',
              borderRadius: '16px',
              zIndex: 301,
              animation: 'modalIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
            }}
          >
            <div
              style={{
                padding: '20px 24px',
                borderBottom: '1px solid #E8E0D8',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#333' }}>
                  📄 Markdown 预览
                </h2>
                <p style={{ fontSize: '13px', color: '#666', marginTop: '2px' }}>
                  文件名：{exportResult.filename}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowExportModal(false);
                  setExportResult(null);
                }}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  color: '#666',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#F5F0EB')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                ✕
              </button>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '24px',
                background: '#FAFAFA',
              }}
            >
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: '13px',
                  lineHeight: 1.7,
                  color: '#333',
                  fontFamily: '"SF Mono", Consolas, "Courier New", monospace',
                  background: '#fff',
                  padding: '20px',
                  borderRadius: '10px',
                  border: '1px solid #E8E0D8',
                }}
              >
                {exportResult.markdown}
              </pre>
            </div>
            <div
              style={{
                padding: '16px 24px',
                borderTop: '1px solid #E8E0D8',
                display: 'flex',
                gap: '12px',
                justifyContent: 'flex-end',
                flexShrink: 0,
              }}
            >
              <button
                onClick={() => {
                  setShowExportModal(false);
                  setExportResult(null);
                }}
                style={{
                  padding: '10px 20px',
                  borderRadius: '10px',
                  background: '#F5F0EB',
                  color: '#555',
                  fontSize: '14px',
                  fontWeight: 600,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#E8E0D8')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#F5F0EB')}
              >
                关闭
              </button>
              <button
                onClick={downloadMarkdown}
                style={{
                  padding: '10px 24px',
                  borderRadius: '10px',
                  background: '#4A90D9',
                  color: '#fff',
                  fontSize: '14px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.2s',
                  boxShadow: '0 2px 8px rgba(74, 144, 217, 0.3)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#3A7BC8';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#4A90D9';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                下载 .md 文件
              </button>
            </div>
          </div>
        </>
      )}

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '40px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '12px 24px',
            background: '#4CAF50',
            color: '#fff',
            borderRadius: '24px',
            fontSize: '14px',
            fontWeight: 600,
            zIndex: 999,
            boxShadow: '0 8px 24px rgba(76, 175, 80, 0.35)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            animation: 'toastIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {toast}
        </div>
      )}
    </div>
  );
}
