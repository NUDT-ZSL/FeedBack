import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import type {
  Exhibition,
  ExhibitionComponent,
  ComponentType,
  ImageComponent,
  TextComponent,
  DividerComponent,
  BannerComponent
} from './types';
import ArtworkCard from './ArtworkCard';

interface DragItem {
  type: ComponentType;
}

interface GuideLine {
  type: 'horizontal' | 'vertical';
  position: number;
}

const ExhibitionBuilder: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [exhibition, setExhibition] = useState<Exhibition | null>(null);
  const [components, setComponents] = useState<ExhibitionComponent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [draggedItem, setDraggedItem] = useState<DragItem | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [guideLines, setGuideLines] = useState<GuideLine[]>([]);
  const [newlyAdded, setNewlyAdded] = useState<Set<string>>(new Set());
  const [isPublishing, setIsPublishing] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const lastPos = useRef({ x: 0, y: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentImageComponentId = useRef<string | null>(null);

  useEffect(() => {
    if (id) {
      fetchExhibition();
    }
  }, [id]);

  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];
    newlyAdded.forEach((compId) => {
      const timer = setTimeout(() => {
        setNewlyAdded((prev) => {
          const next = new Set(prev);
          next.delete(compId);
          return next;
        });
      }, 300);
      timers.push(timer);
    });
    return () => timers.forEach(clearTimeout);
  }, [newlyAdded]);

  const fetchExhibition = async () => {
    try {
      const res = await axios.get(`/api/exhibitions/${id}`);
      setExhibition(res.data);
      setComponents(res.data.components || []);
    } catch (err) {
      console.error('Failed to fetch exhibition:', err);
    }
  };

  const saveExhibition = async (comps: ExhibitionComponent[]) => {
    if (!id) return;
    try {
      await axios.put(`/api/exhibitions/${id}`, { components: comps });
    } catch (err) {
      console.error('Failed to save:', err);
    }
  };

  const themeColor = exhibition?.themeColor;
  const primaryColor = themeColor?.primary || '#2c2c2c';

  const createComponent = (type: ComponentType, x: number, y: number): ExhibitionComponent => {
    const base = {
      id: uuidv4(),
      x,
      y,
      rotation: 0,
      backgroundColor: '#ffffff',
      borderColor: '#dddddd',
      borderWidth: 0,
      shadow: true,
      opacity: 1
    };

    switch (type) {
      case 'image':
        return {
          ...base,
          type: 'image',
          width: 280,
          height: 340,
          imageUrl: '',
          title: '',
          year: '',
          description: ''
        } as ImageComponent;
      case 'text':
        return {
          ...base,
          type: 'text',
          width: 300,
          height: 150,
          content: '',
          fontSize: 16,
          bold: false,
          italic: false,
          textColor: '#2c2c2c'
        } as TextComponent;
      case 'divider':
        return {
          ...base,
          type: 'divider',
          width: 300,
          height: 20,
          color: primaryColor,
          thickness: 2
        } as DividerComponent;
      case 'banner':
        return {
          ...base,
          type: 'banner',
          width: 400,
          height: 100,
          text: '标题文字',
          fontSize: 32,
          textColor: '#ffffff',
          backgroundColor: primaryColor
        } as BannerComponent;
    }
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!draggedItem || !canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left - pan.x) / zoom - 50;
      const y = (e.clientY - rect.top - pan.y) / zoom - 50;

      const newComp = createComponent(draggedItem.type, Math.max(0, x), Math.max(0, y));
      const newComponents = [...components, newComp];
      setComponents(newComponents);
      setNewlyAdded((prev) => new Set(prev).add(newComp.id));
      setSelectedId(newComp.id);
      saveExhibition(newComponents);
      setDraggedItem(null);
    },
    [draggedItem, components, zoom, pan, id]
  );

  const handleComponentMouseDown = (e: React.MouseEvent, compId: string) => {
    if ((e.target as HTMLElement).closest('.handle-area')) return;
    e.stopPropagation();
    const comp = components.find((c) => c.id === compId);
    if (!comp) return;

    setSelectedId(compId);
    setIsDragging(true);

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    setDragOffset({
      x: e.clientX - rect.left - pan.x - comp.x * zoom,
      y: e.clientY - rect.top - pan.y - comp.y * zoom
    });

    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleResizeStart = (e: React.MouseEvent, compId: string, handle: string) => {
    e.stopPropagation();
    setSelectedId(compId);
    setIsResizing(true);
    setResizeHandle(handle);
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const calculateGuideLines = (comp: ExhibitionComponent, allComps: ExhibitionComponent[]): GuideLine[] => {
    const lines: GuideLine[] = [];
    const threshold = 10;

    const compCenterX = comp.x + comp.width / 2;
    const compCenterY = comp.y + comp.height / 2;
    const compRight = comp.x + comp.width;
    const compBottom = comp.y + comp.height;

    allComps.forEach((other) => {
      if (other.id === comp.id) return;

      const otherCenterX = other.x + other.width / 2;
      const otherCenterY = other.y + other.height / 2;
      const otherRight = other.x + other.width;
      const otherBottom = other.y + other.height;

      if (Math.abs(comp.x - other.x) < threshold) {
        lines.push({ type: 'vertical', position: other.x });
      }
      if (Math.abs(compRight - otherRight) < threshold) {
        lines.push({ type: 'vertical', position: otherRight });
      }
      if (Math.abs(compCenterX - otherCenterX) < threshold) {
        lines.push({ type: 'vertical', position: otherCenterX });
      }
      if (Math.abs(comp.x - otherRight) < threshold) {
        lines.push({ type: 'vertical', position: otherRight });
      }
      if (Math.abs(compRight - other.x) < threshold) {
        lines.push({ type: 'vertical', position: other.x });
      }

      if (Math.abs(comp.y - other.y) < threshold) {
        lines.push({ type: 'horizontal', position: other.y });
      }
      if (Math.abs(compBottom - otherBottom) < threshold) {
        lines.push({ type: 'horizontal', position: otherBottom });
      }
      if (Math.abs(compCenterY - otherCenterY) < threshold) {
        lines.push({ type: 'horizontal', position: otherCenterY });
      }
      if (Math.abs(comp.y - otherBottom) < threshold) {
        lines.push({ type: 'horizontal', position: otherBottom });
      }
      if (Math.abs(compBottom - other.y) < threshold) {
        lines.push({ type: 'horizontal', position: other.y });
      }
    });

    return lines;
  };

  const snapToGuide = (value: number, positions: number[], threshold = 10): number => {
    for (const pos of positions) {
      if (Math.abs(value - pos) < threshold) {
        return pos;
      }
    }
    return value;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging && selectedId) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        setComponents((prev) => {
          const idx = prev.findIndex((c) => c.id === selectedId);
          if (idx === -1) return prev;

          const comp = prev[idx];
          let newX = (e.clientX - rect.left - pan.x - dragOffset.x) / zoom;
          let newY = (e.clientY - rect.top - pan.y - dragOffset.y) / zoom;

          const hGuides = calculateGuideLines({ ...comp, x: newX, y: newY }, prev);
          const vPositions = hGuides.filter((g) => g.type === 'vertical').map((g) => g.position);
          const hPositions = hGuides.filter((g) => g.type === 'horizontal').map((g) => g.position);

          newX = snapToGuide(newX, vPositions);
          newX = snapToGuide(newX + comp.width, vPositions) - comp.width;
          newX = snapToGuide(newX + comp.width / 2, vPositions) - comp.width / 2;

          newY = snapToGuide(newY, hPositions);
          newY = snapToGuide(newY + comp.height, hPositions) - comp.height;
          newY = snapToGuide(newY + comp.height / 2, hPositions) - comp.height / 2;

          const allGuides = calculateGuideLines({ ...comp, x: newX, y: newY }, prev);
          setGuideLines(allGuides);

          const next = [...prev];
          next[idx] = { ...comp, x: Math.max(0, newX), y: Math.max(0, newY) };
          return next;
        });
      }

      if (isResizing && selectedId && resizeHandle) {
        const dx = (e.clientX - lastPos.current.x) / zoom;
        const dy = (e.clientY - lastPos.current.y) / zoom;

        setComponents((prev) => {
          const idx = prev.findIndex((c) => c.id === selectedId);
          if (idx === -1) return prev;

          const comp = prev[idx];
          const next = [...prev];

          let newWidth = comp.width;
          let newHeight = comp.height;
          let newX = comp.x;
          let newY = comp.y;

          if (resizeHandle === 'nw') {
            newWidth = Math.max(50, comp.width - dx);
            newHeight = Math.max(50, comp.height - dy);
            newX = comp.x + (comp.width - newWidth);
            newY = comp.y + (comp.height - newHeight);
          } else if (resizeHandle === 'se') {
            newWidth = Math.max(50, comp.width + dx);
            newHeight = Math.max(50, comp.height + dy);
          }

          next[idx] = { ...comp, width: newWidth, height: newHeight, x: newX, y: newY };
          return next;
        });

        lastPos.current = { x: e.clientX, y: e.clientY };
      }

      if (isPanning) {
        const dx = e.clientX - lastPos.current.x;
        const dy = e.clientY - lastPos.current.y;
        setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
        lastPos.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseUp = () => {
      if (isDragging || isResizing) {
        saveExhibition(components);
      }
      setIsDragging(false);
      setIsResizing(false);
      setIsPanning(false);
      setResizeHandle(null);
      setGuideLines([]);
    };

    if (isDragging || isResizing || isPanning) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, isPanning, selectedId, dragOffset, zoom, pan, resizeHandle, components]);

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.target === canvasRef.current || (e.target as HTMLElement).classList.contains('canvas-bg')) {
      setSelectedId(null);
      setIsPanning(true);
      lastPos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((prev) => Math.min(2, Math.max(0.5, prev * delta)));
  };

  const handleRotate = (compId: string) => {
    setComponents((prev) => {
      const idx = prev.findIndex((c) => c.id === compId);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], rotation: (next[idx].rotation + 90) % 360 };
      saveExhibition(next);
      return next;
    });
  };

  const updateComponent = (compId: string, updates: Partial<ExhibitionComponent>) => {
    setComponents((prev) => {
      const idx = prev.findIndex((c) => c.id === compId);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], ...updates } as ExhibitionComponent;
      saveExhibition(next);
      return next;
    });
  };

  const deleteComponent = (compId: string) => {
    setComponents((prev) => {
      const next = prev.filter((c) => c.id !== compId);
      saveExhibition(next);
      return next;
    });
    if (selectedId === compId) setSelectedId(null);
  };

  const handleImageUploadClick = (compId: string) => {
    currentImageComponentId.current = compId;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentImageComponentId.current) return;

    const formData = new FormData();
    formData.append('image', file);

    try {
      const res = await axios.post('/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      updateComponent(currentImageComponentId.current, { imageUrl: res.data.url });
    } catch (err) {
      console.error('Upload failed:', err);
    }

    e.target.value = '';
    currentImageComponentId.current = null;
  };

  const handlePublish = async () => {
    if (!id) return;
    setIsPublishing(true);
    try {
      await axios.post(`/api/exhibitions/${id}/publish`);
      navigate(`/exhibition/${id}`);
    } catch (err) {
      console.error('Publish failed:', err);
      setIsPublishing(false);
    }
  };

  const selectedComponent = components.find((c) => c.id === selectedId);

  const renderComponentContent = (comp: ExhibitionComponent) => {
    switch (comp.type) {
      case 'image':
        return (
          <div onClick={() => handleImageUploadClick(comp.id)} style={{ width: '100%', height: '100%' }}>
            <ArtworkCard component={comp} />
          </div>
        );
      case 'text':
        return (
          <div
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => {
              const text = e.currentTarget.innerText.slice(0, 500);
              updateComponent(comp.id, { content: text } as Partial<TextComponent>);
            }}
            style={{
              width: '100%',
              height: '100%',
              padding: '16px',
              fontSize: comp.fontSize,
              fontWeight: comp.bold ? 700 : 400,
              fontStyle: comp.italic ? 'italic' : 'normal',
              color: comp.textColor,
              lineHeight: 1.6,
              outline: 'none',
              overflow: 'auto',
              boxSizing: 'border-box'
            }}
          >
            {comp.content || '点击输入文字（最多500字）...'}
          </div>
        );
      case 'divider':
        return (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <div
              style={{
                width: '80%',
                height: comp.thickness,
                backgroundColor: comp.color,
                borderRadius: '2px'
              }}
            />
          </div>
        );
      case 'banner':
        return (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: comp.backgroundColor,
              borderRadius: '8px'
            }}
          >
            <div
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => {
                updateComponent(comp.id, { text: e.currentTarget.innerText } as Partial<BannerComponent>);
              }}
              style={{
                fontSize: comp.fontSize,
                color: comp.textColor,
                fontWeight: 700,
                outline: 'none',
                textAlign: 'center',
                padding: '0 20px'
              }}
            >
              {comp.text}
            </div>
          </div>
        );
    }
  };

  const paletteOptions = [
    { type: 'image' as ComponentType, label: '图片框', icon: '🖼️', desc: '展示艺术品图片' },
    { type: 'text' as ComponentType, label: '文字块', icon: '📝', desc: '多行文本说明' },
    { type: 'divider' as ComponentType, label: '分隔线', icon: '➖', desc: '装饰分割线' },
    { type: 'banner' as ComponentType, label: '标题横幅', icon: '🏷️', desc: '大字号标题' }
  ];

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          height: '60px',
          backgroundColor: '#fff',
          borderBottom: '1px solid #e8e4de',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid #ddd',
              backgroundColor: '#fff',
              color: '#2c2c2c',
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'all 0.2s ease-out'
            }}
          >
            ← 返回
          </button>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: '#2c2c2c' }}>
              {exhibition?.name || '加载中...'}
            </div>
            <div style={{ fontSize: '12px', color: '#888' }}>{exhibition?.description}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '6px',
                border: '1px solid #ddd',
                backgroundColor: '#fff',
                cursor: 'pointer',
                fontSize: '16px'
              }}
            >
              −
            </button>
            <span style={{ fontSize: '13px', color: '#666', minWidth: '48px', textAlign: 'center' }}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '6px',
                border: '1px solid #ddd',
                backgroundColor: '#fff',
                cursor: 'pointer',
                fontSize: '16px'
              }}
            >
              +
            </button>
            <button
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid #ddd',
                backgroundColor: '#fff',
                cursor: 'pointer',
                fontSize: '12px',
                marginLeft: '4px'
              }}
            >
              重置
            </button>
          </div>

          <button
            onClick={handlePublish}
            disabled={isPublishing}
            style={{
              padding: '10px 24px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: primaryColor,
              color: '#fff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: isPublishing ? 'not-allowed' : 'pointer',
              opacity: isPublishing ? 0.6 : 1,
              transition: 'all 0.2s ease-out'
            }}
            onMouseEnter={(e) => {
              if (!isPublishing) e.currentTarget.style.filter = 'brightness(1.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.filter = 'brightness(1)';
            }}
            onMouseDown={(e) => {
              if (!isPublishing) e.currentTarget.style.transform = 'scale(0.95)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            {isPublishing ? '发布中...' : '发布展览'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div
          style={{
            width: '240px',
            backgroundColor: '#fff',
            borderRight: '1px solid #e8e4de',
            padding: '20px',
            overflowY: 'auto',
            flexShrink: 0
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#2c2c2c', marginBottom: '16px' }}>
            组件面板
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {paletteOptions.map((opt) => (
              <div
                key={opt.type}
                draggable
                onDragStart={(e) => {
                  setDraggedItem({ type: opt.type });
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onDragEnd={() => setDraggedItem(null)}
                style={{
                  padding: '14px',
                  borderRadius: '8px',
                  backgroundColor: '#f8f5f0',
                  border: '1px solid #e8e4de',
                  cursor: 'grab',
                  transition: 'all 0.2s ease-out',
                  userSelect: 'none'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#f0ebe4';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#f8f5f0';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '22px' }}>{opt.icon}</span>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#2c2c2c' }}>
                      {opt.label}
                    </div>
                    <div style={{ fontSize: '11px', color: '#888' }}>{opt.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {selectedComponent && (
            <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #e8e4de' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#2c2c2c', marginBottom: '16px' }}>
                样式设置
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
                    背景色
                  </label>
                  <input
                    type="color"
                    value={selectedComponent.backgroundColor}
                    onChange={(e) => updateComponent(selectedComponent.id, { backgroundColor: e.target.value })}
                    style={{ width: '100%', height: '32px', borderRadius: '6px', border: '1px solid #ddd', cursor: 'pointer' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
                    边框颜色
                  </label>
                  <input
                    type="color"
                    value={selectedComponent.borderColor}
                    onChange={(e) => updateComponent(selectedComponent.id, { borderColor: e.target.value })}
                    style={{ width: '100%', height: '32px', borderRadius: '6px', border: '1px solid #ddd', cursor: 'pointer' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
                    边框宽度: {selectedComponent.borderWidth}px
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    value={selectedComponent.borderWidth}
                    onChange={(e) => updateComponent(selectedComponent.id, { borderWidth: Number(e.target.value) })}
                    style={{ width: '100%' }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <label style={{ fontSize: '12px', color: '#666' }}>阴影</label>
                  <button
                    onClick={() => updateComponent(selectedComponent.id, { shadow: !selectedComponent.shadow })}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: '1px solid #ddd',
                      backgroundColor: selectedComponent.shadow ? primaryColor : '#fff',
                      color: selectedComponent.shadow ? '#fff' : '#2c2c2c',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    {selectedComponent.shadow ? '开启' : '关闭'}
                  </button>
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
                    透明度: {Math.round(selectedComponent.opacity * 100)}%
                  </label>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={selectedComponent.opacity * 100}
                    onChange={(e) => updateComponent(selectedComponent.id, { opacity: Number(e.target.value) / 100 })}
                    style={{ width: '100%' }}
                  />
                </div>

                {selectedComponent.type === 'text' && (
                  <>
                    <div>
                      <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
                        文字颜色
                      </label>
                      <input
                        type="color"
                        value={(selectedComponent as TextComponent).textColor}
                        onChange={(e) =>
                          updateComponent(selectedComponent.id, { textColor: e.target.value } as Partial<TextComponent>)
                        }
                        style={{ width: '100%', height: '32px', borderRadius: '6px', border: '1px solid #ddd', cursor: 'pointer' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
                        字号: {(selectedComponent as TextComponent).fontSize}px
                      </label>
                      <input
                        type="range"
                        min={12}
                        max={48}
                        value={(selectedComponent as TextComponent).fontSize}
                        onChange={(e) =>
                          updateComponent(selectedComponent.id, { fontSize: Number(e.target.value) } as Partial<TextComponent>)
                        }
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() =>
                          updateComponent(selectedComponent.id, {
                            bold: !(selectedComponent as TextComponent).bold
                          } as Partial<TextComponent>)
                        }
                        style={{
                          flex: 1,
                          padding: '8px',
                          borderRadius: '6px',
                          border: '1px solid #ddd',
                          backgroundColor: (selectedComponent as TextComponent).bold ? primaryColor : '#fff',
                          color: (selectedComponent as TextComponent).bold ? '#fff' : '#2c2c2c',
                          cursor: 'pointer',
                          fontWeight: 700
                        }}
                      >
                        B
                      </button>
                      <button
                        onClick={() =>
                          updateComponent(selectedComponent.id, {
                            italic: !(selectedComponent as TextComponent).italic
                          } as Partial<TextComponent>)
                        }
                        style={{
                          flex: 1,
                          padding: '8px',
                          borderRadius: '6px',
                          border: '1px solid #ddd',
                          backgroundColor: (selectedComponent as TextComponent).italic ? primaryColor : '#fff',
                          color: (selectedComponent as TextComponent).italic ? '#fff' : '#2c2c2c',
                          cursor: 'pointer',
                          fontStyle: 'italic'
                        }}
                      >
                        I
                      </button>
                    </div>
                  </>
                )}

                {selectedComponent.type === 'divider' && (
                  <>
                    <div>
                      <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
                        线条颜色
                      </label>
                      <input
                        type="color"
                        value={(selectedComponent as DividerComponent).color}
                        onChange={(e) =>
                          updateComponent(selectedComponent.id, { color: e.target.value } as Partial<DividerComponent>)
                        }
                        style={{ width: '100%', height: '32px', borderRadius: '6px', border: '1px solid #ddd', cursor: 'pointer' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
                        线条粗细: {(selectedComponent as DividerComponent).thickness}px
                      </label>
                      <input
                        type="range"
                        min={1}
                        max={20}
                        value={(selectedComponent as DividerComponent).thickness}
                        onChange={(e) =>
                          updateComponent(selectedComponent.id, {
                            thickness: Number(e.target.value)
                          } as Partial<DividerComponent>)
                        }
                        style={{ width: '100%' }}
                      />
                    </div>
                  </>
                )}

                {selectedComponent.type === 'banner' && (
                  <>
                    <div>
                      <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
                        文字颜色
                      </label>
                      <input
                        type="color"
                        value={(selectedComponent as BannerComponent).textColor}
                        onChange={(e) =>
                          updateComponent(selectedComponent.id, { textColor: e.target.value } as Partial<BannerComponent>)
                        }
                        style={{ width: '100%', height: '32px', borderRadius: '6px', border: '1px solid #ddd', cursor: 'pointer' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
                        字号: {(selectedComponent as BannerComponent).fontSize}px
                      </label>
                      <input
                        type="range"
                        min={18}
                        max={72}
                        value={(selectedComponent as BannerComponent).fontSize}
                        onChange={(e) =>
                          updateComponent(selectedComponent.id, {
                            fontSize: Number(e.target.value)
                          } as Partial<BannerComponent>)
                        }
                        style={{ width: '100%' }}
                      />
                    </div>
                  </>
                )}

                {selectedComponent.type === 'image' && (
                  <>
                    <button
                      onClick={() => handleImageUploadClick(selectedComponent.id)}
                      style={{
                        padding: '10px',
                        borderRadius: '6px',
                        border: 'none',
                        backgroundColor: primaryColor,
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      上传图片
                    </button>
                    <input
                      type="text"
                      placeholder="艺术品标题"
                      value={(selectedComponent as ImageComponent).title}
                      onChange={(e) =>
                        updateComponent(selectedComponent.id, { title: e.target.value } as Partial<ImageComponent>)
                      }
                      style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid #ddd',
                        fontSize: '13px',
                        outline: 'none'
                      }}
                    />
                    <input
                      type="text"
                      placeholder="创作年代"
                      value={(selectedComponent as ImageComponent).year}
                      onChange={(e) =>
                        updateComponent(selectedComponent.id, { year: e.target.value } as Partial<ImageComponent>)
                      }
                      style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid #ddd',
                        fontSize: '13px',
                        outline: 'none'
                      }}
                    />
                    <textarea
                      placeholder="艺术品简介"
                      value={(selectedComponent as ImageComponent).description}
                      onChange={(e) =>
                        updateComponent(selectedComponent.id, {
                          description: e.target.value
                        } as Partial<ImageComponent>)
                      }
                      rows={3}
                      style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid #ddd',
                        fontSize: '13px',
                        outline: 'none',
                        resize: 'none',
                        fontFamily: 'inherit'
                      }}
                    />
                  </>
                )}

                <button
                  onClick={() => deleteComponent(selectedComponent.id)}
                  style={{
                    marginTop: '8px',
                    padding: '10px',
                    borderRadius: '6px',
                    border: '1px solid #e57373',
                    backgroundColor: '#fff',
                    color: '#e57373',
                    cursor: 'pointer',
                    fontSize: '13px',
                    transition: 'all 0.2s ease-out'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#ffebee';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#fff';
                  }}
                >
                  删除组件
                </button>
              </div>
            </div>
          )}
        </div>

        <div
          ref={canvasRef}
          className="canvas-bg"
          onMouseDown={handleCanvasMouseDown}
          onWheel={handleWheel}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          style={{
            flex: 1,
            backgroundColor: '#e8e4de',
            position: 'relative',
            overflow: 'hidden',
            cursor: isPanning ? 'grabbing' : draggedItem ? 'copy' : 'grab'
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: `translate(${pan.x}px, ${pan.y}px) translate(-50%, -50%) scale(${zoom})`,
              transformOrigin: 'center center',
              width: '1200px',
              height: '800px',
              backgroundColor: themeColor?.background || '#fafafa',
              boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
              borderRadius: '4px'
            }}
          >
            {guideLines.map((line, idx) => (
              <div
                key={idx}
                style={{
                  position: 'absolute',
                  backgroundColor: 'rgba(66, 133, 244, 0.8)',
                  zIndex: 100,
                  pointerEvents: 'none',
                  ...(line.type === 'vertical'
                    ? { left: line.position, top: 0, width: 1, height: '100%' }
                    : { top: line.position, left: 0, height: 1, width: '100%' })
                }}
              />
            ))}

            {components.map((comp) => {
              const isSelected = comp.id === selectedId;
              const isNew = newlyAdded.has(comp.id);
              return (
                <div
                  key={comp.id}
                  onMouseDown={(e) => handleComponentMouseDown(e, comp.id)}
                  style={{
                    position: 'absolute',
                    left: comp.x,
                    top: comp.y,
                    width: comp.width,
                    height: comp.height,
                    transform: `rotate(${comp.rotation}deg)`,
                    zIndex: isSelected ? 10 : 1,
                    animation: isNew ? 'popIn 0.3s ease-out' : undefined
                  }}
                >
                  <div style={{ width: '100%', height: '100%' }}>{renderComponentContent(comp)}</div>

                  {isSelected && (
                    <>
                      <div
                        className="handle-area"
                        onMouseDown={(e) => handleResizeStart(e, comp.id, 'nw')}
                        style={{
                          position: 'absolute',
                          left: '-8px',
                          top: '-8px',
                          width: '16px',
                          height: '16px',
                          backgroundColor: primaryColor,
                          border: '2px solid #fff',
                          borderRadius: '50%',
                          cursor: 'nwse-resize',
                          zIndex: 20
                        }}
                      />
                      <div
                        className="handle-area"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRotate(comp.id);
                        }}
                        style={{
                          position: 'absolute',
                          right: '-8px',
                          top: '-8px',
                          width: '16px',
                          height: '16px',
                          backgroundColor: primaryColor,
                          border: '2px solid #fff',
                          borderRadius: '50%',
                          cursor: 'pointer',
                          zIndex: 20,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontSize: '10px'
                        }}
                      >
                        ↻
                      </div>
                      <div
                        className="handle-area"
                        onMouseDown={(e) => handleResizeStart(e, comp.id, 'se')}
                        style={{
                          position: 'absolute',
                          right: '-8px',
                          bottom: '-8px',
                          width: '16px',
                          height: '16px',
                          backgroundColor: primaryColor,
                          border: '2px solid #fff',
                          borderRadius: '50%',
                          cursor: 'nwse-resize',
                          zIndex: 20
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          inset: '-2px',
                          border: `2px solid ${primaryColor}`,
                          borderRadius: '8px',
                          pointerEvents: 'none',
                          zIndex: 5
                        }}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <style>{`
        @keyframes popIn {
          0% {
            opacity: 0;
            transform: scale(0.5);
          }
          70% {
            transform: scale(1.05);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
        @media (max-width: 768px) {
          > div:first-child > div:nth-child(2) {
            flex-direction: column !important;
            height: auto !important;
          }
          > div:nth-child(2) {
            flex-direction: column !important;
          }
          > div:nth-child(2) > div:first-child {
            width: 100% !important;
            max-height: 200px;
            overflow-x: auto;
          }
        }
      `}</style>
    </div>
  );
};

export default ExhibitionBuilder;
