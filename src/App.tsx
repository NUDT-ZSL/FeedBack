import { useState, useEffect, useCallback } from 'react';
import CardEditor from './components/CardEditor';
import TemplateList from './components/TemplateList';
import HistoryGallery from './components/HistoryGallery';
import { CardElement, Template, HistoryCard, TEMPLATES, EMOJI_MAP, ElementType } from './types';
import { generateThumbnail } from './utils/exportImage';

type Page = 'home' | 'editor';

const STORAGE_KEY = 'birthday_card_history';
const MAX_HISTORY = 3;

export default function App() {
  const [page, setPage] = useState<Page>('home');
  const [elements, setElements] = useState<CardElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [backgroundColor, setBackgroundColor] = useState<string>('#FFE4EC');
  const [currentTemplateId, setCurrentTemplateId] = useState<string>('cute');
  const [history, setHistory] = useState<HistoryCard[]>([]);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [cardRef, setCardRef] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load history', e);
      }
    }
  }, []);

  const saveHistory = useCallback(async (cardElements: CardElement[], bg: string, templateId: string, ref: HTMLDivElement | null) => {
    if (!ref) return;
    try {
      const thumbnail = await generateThumbnail(ref);
      const newItem: HistoryCard = {
        id: Date.now().toString(),
        thumbnail,
        elements: JSON.parse(JSON.stringify(cardElements)),
        backgroundColor: bg,
        templateId,
        savedAt: Date.now(),
      };
      setHistory(prev => {
        const updated = [newItem, ...prev].slice(0, MAX_HISTORY);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    } catch (e) {
      console.error('Failed to save history', e);
    }
  }, []);

  const applyTemplate = useCallback((template: Template) => {
    const newElements: CardElement[] = template.elements.map(el => ({
      ...el,
      id: Math.random().toString(36).slice(2, 11),
    }));
    setElements(newElements);
    setBackgroundColor(template.backgroundColor);
    setCurrentTemplateId(template.id);
    setSelectedId(null);
  }, []);

  const startNewCard = useCallback(() => {
    applyTemplate(TEMPLATES[0]);
    setPage('editor');
  }, [applyTemplate]);

  const openFromTemplate = useCallback((template: Template) => {
    applyTemplate(template);
    setPage('editor');
  }, [applyTemplate]);

  const restoreFromHistory = useCallback((item: HistoryCard) => {
    setElements(JSON.parse(JSON.stringify(item.elements)));
    setBackgroundColor(item.backgroundColor);
    setCurrentTemplateId(item.templateId);
    setSelectedId(null);
    setPage('editor');
  }, []);

  const deleteHistoryItem = useCallback((id: string) => {
    setHistory(prev => {
      const updated = prev.filter(h => h.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const addElement = useCallback((type: ElementType) => {
    const newEl: CardElement = {
      id: Math.random().toString(36).slice(2, 11),
      type,
      x: 350,
      y: 220,
      width: type === 'text' ? 200 : 60,
      height: type === 'text' ? 50 : 60,
      rotation: 0,
    };
    if (type === 'text') {
      newEl.content = '点击编辑文字';
      newEl.fontSize = 24;
      newEl.fontFamily = '"Microsoft YaHei", "PingFang SC", sans-serif';
      newEl.fontColor = '#2C3E50';
      newEl.shadow = { offsetX: 0, offsetY: 0, blur: 0, color: 'rgba(0,0,0,0)' };
    } else {
      newEl.emoji = EMOJI_MAP[type];
      const fontSizeMap: Record<ElementType, number> = {
        balloon: 72, cake: 80, star: 56, heart: 56, gift: 64, text: 24,
      };
      newEl.fontSize = fontSizeMap[type];
    }
    setElements(prev => [...prev, newEl]);
    setSelectedId(newEl.id);
  }, []);

  const updateElement = useCallback((id: string, updates: Partial<CardElement>) => {
    setElements(prev => prev.map(el => el.id === id ? { ...el, ...updates } : el));
  }, []);

  const deleteElement = useCallback((id: string) => {
    setElements(prev => prev.filter(el => el.id !== id));
    if (selectedId === id) setSelectedId(null);
  }, [selectedId]);

  const goHome = useCallback(() => {
    setPage('home');
    setMobileDrawerOpen(false);
  }, []);

  return (
    <div className="app-container">
      <nav className="navbar">
        <h1>🎉 生日贺卡生成器</h1>
        <div className="nav-actions">
          {page === 'editor' ? (
            <span className="back-link" onClick={goHome}>← 返回首页</span>
          ) : (
            <button className="btn" onClick={startNewCard}>
              ✨ 开始制作
            </button>
          )}
        </div>
      </nav>

      <div className="main-content">
        {page === 'home' ? (
          <div className="home-page">
            <h2>🎂 欢迎来到生日贺卡生成器</h2>
            <p className="subtitle">轻松创建个性化的生日贺卡，为亲爱的人送去祝福</p>

            <div className="home-actions">
              <button className="btn" onClick={startNewCard}>🎨 从零开始创建</button>
            </div>

            <div className="tool-section">
              <h3 className="tool-section-title">📐 选择模板</h3>
              <TemplateList onSelect={openFromTemplate} compact={false} />
            </div>

            <div style={{ marginTop: '48px' }}>
              <h3 className="tool-section-title" style={{ fontSize: '18px', marginBottom: '20px' }}>
                🕐 最近编辑的贺卡
              </h3>
              <HistoryGallery
                history={history}
                onRestore={restoreFromHistory}
                onDelete={deleteHistoryItem}
              />
            </div>
          </div>
        ) : (
          <CardEditor
            elements={elements}
            selectedId={selectedId}
            backgroundColor={backgroundColor}
            currentTemplateId={currentTemplateId}
            templates={TEMPLATES}
            mobileDrawerOpen={mobileDrawerOpen}
            onSelect={setSelectedId}
            onAddElement={addElement}
            onUpdateElement={updateElement}
            onDeleteElement={deleteElement}
            onApplyTemplate={applyTemplate}
            onSetBackground={setBackgroundColor}
            onToggleDrawer={() => setMobileDrawerOpen(v => !v)}
            onCloseDrawer={() => setMobileDrawerOpen(false)}
            onCardRef={setCardRef}
            onSaveHistory={() => saveHistory(elements, backgroundColor, currentTemplateId, cardRef)}
          />
        )}
      </div>
    </div>
  );
}
