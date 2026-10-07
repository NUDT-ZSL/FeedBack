import { useState } from 'react';
import { LocaleContext } from './LocaleContext';
import { getMessage, Locale, MessageKey } from './i18n';
import { BrushStroke, Line, SILK_COLORS, SKELETONS, Work } from './types';
import { createWork, downloadDataURL, exportWorkPNG, formatTimestamp } from './workUtils';
import Workbench from './Workbench';
import LanternThumb from './LanternThumb';

export default function App() {
  const [locale, setLocale] = useState<Locale>('zh');
  const [works, setWorks] = useState<Work[]>(() => [createWork()]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const t = (key: MessageKey) => getMessage(locale, key);
  const toggleLocale = () => setLocale((prev) => (prev === 'zh' ? 'en' : 'zh'));

  const currentWork = works.find((item) => item.id === currentId) ?? works[0] ?? null;
  const savedWorks = works.filter((item) => item.saved);
  const previewWork = previewId ? works.find((item) => item.id === previewId) ?? null : null;

  const updateWork = (id: string, patch: Partial<Work>) => {
    setWorks((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const addStroke = (id: string, stroke: BrushStroke) => {
    setWorks((prev) =>
      prev.map((item) => (item.id === id ? { ...item, strokes: [...item.strokes, stroke] } : item))
    );
  };

  const addLine = (id: string, line: Line) => {
    setWorks((prev) =>
      prev.map((item) => (item.id === id ? { ...item, lines: [...item.lines, line] } : item))
    );
  };

  const newWork = () => {
    const work = createWork();
    setWorks((prev) => [...prev, work]);
    setCurrentId(work.id);
  };

  const selectWork = (id: string) => {
    setCurrentId(id);
  };

  const deleteWork = (id: string) => {
    setWorks((prev) => prev.filter((item) => item.id !== id));
    setCurrentId((prev) => (prev === id ? null : prev));
    setPreviewId((prev) => (prev === id ? null : prev));
  };

  const clearWork = (id: string) => {
    updateWork(id, {
      skeletonId: null,
      silkColorId: null,
      strokes: [],
      lines: [],
      isLit: false,
      saved: false,
    });
  };

  const saveWork = (id: string) => {
    updateWork(id, { saved: true });
  };

  const downloadWork = (work: Work) => {
    downloadDataURL(exportWorkPNG(work), `lantern-${work.randomId}.png`);
  };

  const editWork = (id: string) => {
    setCurrentId(id);
    setPreviewId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const skeletonName = (work: Work) => {
    const skeleton = SKELETONS.find((item) => item.id === work.skeletonId);
    return skeleton ? (locale === 'zh' ? skeleton.name.zh : skeleton.name.en) : '';
  };

  const silkHex = (work: Work) => {
    const silk = SILK_COLORS.find((item) => item.id === work.silkColorId);
    return silk ? silk.hex : null;
  };

  return (
    <LocaleContext.Provider value={{ locale, toggleLocale, t }}>
      <div className="app">
        <header className="shop-header">
          <div className="hanging-lanterns" aria-hidden="true">
            <div className="hanging-lantern" />
            <div className="hanging-lantern" />
            <div className="hanging-lantern" />
          </div>
          <h1 className="shop-title">{t('title')}</h1>
          <p className="shop-subtitle">{t('subtitle')}</p>
          <button type="button" className="btn lang-toggle" onClick={toggleLocale}>
            {locale === 'zh' ? 'EN' : '中文'}
          </button>
        </header>

        <section className="works-bar">
          <span className="works-bar-label">{t('myWorks')}</span>
          <div className="works-list" data-testid="works-list">
            {works.map((work) => (
              <button
                key={work.id}
                type="button"
                className={`work-chip${currentWork?.id === work.id ? ' active' : ''}`}
                onClick={() => selectWork(work.id)}
                data-testid={`work-chip-${work.id}`}
              >
                <span className="chip-id">#{work.randomId}</span>
                {silkHex(work) && (
                  <span className="silk-dot" style={{ backgroundColor: silkHex(work)! }} />
                )}
                {skeletonName(work) && <span className="chip-skeleton">{skeletonName(work)}</span>}
                {work.isLit && <span className="lit-icon">🔥</span>}
                <span
                  className="chip-delete"
                  role="button"
                  aria-label={t('deleteWork')}
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteWork(work.id);
                  }}
                  data-testid={`delete-work-${work.id}`}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
          <button type="button" className="btn" onClick={newWork} data-testid="new-lantern">
            + {t('newLantern')}
          </button>
        </section>

        <main>
          {currentWork ? (
            <Workbench
              work={currentWork}
              onUpdate={updateWork}
              onAddStroke={addStroke}
              onAddLine={addLine}
              onSave={saveWork}
              onDownload={downloadWork}
              onClear={clearWork}
            />
          ) : (
            <div className="empty-stage">
              <p>{t('noWorkHint')}</p>
              <button type="button" className="btn" onClick={newWork}>
                + {t('newLantern')}
              </button>
            </div>
          )}
        </main>

        <section className="wall-section">
          <h2 className="wall-title">{t('collectionWall')}</h2>
          {savedWorks.length === 0 ? (
            <p className="wall-empty" data-testid="wall-empty">
              {t('emptyWall')}
            </p>
          ) : (
            <div className="masonry" data-testid="lantern-wall">
              {savedWorks.map((work) => (
                <div
                  key={work.id}
                  className={`wall-card${currentWork?.id === work.id ? ' current' : ''}`}
                  data-testid={`wall-card-${work.id}`}
                >
                  {currentWork?.id === work.id && (
                    <span className="current-badge">{t('currentBadge')}</span>
                  )}
                  <LanternThumb
                    work={work}
                    size={180}
                    className={`wall-thumb${work.isLit ? ' lit' : ''}`}
                    onClick={() => setPreviewId(work.id)}
                  />
                  <div className="wall-meta">
                    <div>
                      {t('lanternId')}: #{work.randomId}
                      {work.isLit && <span className="lit-icon"> 🔥</span>}
                    </div>
                    <div>
                      {t('createdAt')}: {formatTimestamp(work.createdAt, locale)}
                    </div>
                  </div>
                  <div className="wall-actions">
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => editWork(work.id)}
                      data-testid={`edit-work-${work.id}`}
                    >
                      {t('editWork')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => downloadWork(work)}
                      data-testid={`download-work-${work.id}`}
                    >
                      {t('download')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-secondary"
                      onClick={() => deleteWork(work.id)}
                      data-testid={`delete-wall-${work.id}`}
                    >
                      {t('deleteWork')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {previewWork && (
          <div className="modal-overlay" onClick={() => setPreviewId(null)}>
            <div className="modal-card" onClick={(event) => event.stopPropagation()}>
              <LanternThumb
                work={previewWork}
                size={320}
                className={`modal-thumb${previewWork.isLit ? ' lit' : ''}`}
              />
              <div className="wall-meta modal-meta">
                <div>
                  {t('lanternId')}: #{previewWork.randomId}
                </div>
                <div>
                  {t('createdAt')}: {formatTimestamp(previewWork.createdAt, locale)}
                </div>
              </div>
              <div className="wall-actions modal-actions">
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => editWork(previewWork.id)}
                >
                  {t('editWork')}
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => downloadWork(previewWork)}
                >
                  {t('download')}
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-secondary"
                  onClick={() => setPreviewId(null)}
                >
                  {t('close')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </LocaleContext.Provider>
  );
}
