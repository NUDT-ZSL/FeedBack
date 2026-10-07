import React, { createContext, useContext, useMemo, useState } from 'react';
import { Workbench } from './Workbench';
import { LanternStudioProvider, useLanternStudio } from './store/useLanternStudio';
import { Locale, MessageKey, getMessage } from './i18n';
import { LanternWork, SKELETONS } from './types';
import { renderWorkThumbnail, renderWorkFullImage } from './renderAdapter';
import './App.css';

interface LangContextValue {
  lang: Locale;
  toggle: () => void;
  t: (key: MessageKey) => string;
}

const LangContext = createContext<LangContextValue | null>(null);

const useLang = (): LangContextValue => {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used within LangProvider');
  return ctx;
};

const LangProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLang] = useState<Locale>('zh');
  const value = useMemo<LangContextValue>(
    () => ({
      lang,
      toggle: () => setLang((l) => (l === 'zh' ? 'en' : 'zh')),
      t: (key) => getMessage(lang, key),
    }),
    [lang]
  );
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
};

const formatTime = (ts: number, lang: Locale): string =>
  new Date(ts).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const WorksBar: React.FC = () => {
  const { t, lang } = useLang();
  const { state, current, dispatch } = useLanternStudio();

  return (
    <div className="works-bar panel">
      <button
        type="button"
        className="btn primary"
        onClick={() => dispatch({ type: 'newWork' })}
      >
        ＋ {t('newWork')}
      </button>
      <div className="works-chips">
        {state.order.length === 0 && (
          <span className="empty-note">{t('emptyStudio')}</span>
        )}
        {state.order.map((id) => {
          const work = state.works[id];
          if (!work) return null;
          const skeletonDef = SKELETONS.find((s) => s.id === work.skeleton);
          const isCurrent = current?.id === id;
          return (
            <div
              key={id}
              className={`work-chip${isCurrent ? ' current' : ''}${work.isLit ? ' lit' : ''}`}
              onClick={() => dispatch({ type: 'switchWork', id })}
              title={t('switchTo')}
            >
              <span className="chip-name">
                {work.isLit ? '🏮 ' : ''}
                {skeletonDef ? skeletonDef.name[lang] : '…'} · {work.randomId}
              </span>
              <span className={`chip-badge${work.savedAt !== null ? ' saved' : ''}`}>
                {work.savedAt !== null ? t('onTheWall') : t('unsaved')}
              </span>
              <button
                type="button"
                className="chip-delete"
                title={t('deleteWork')}
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(t('confirmDelete'))) {
                    dispatch({ type: 'removeWork', id });
                  }
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const WallCard: React.FC<{ work: LanternWork; onPreview: (w: LanternWork) => void }> = ({
  work,
  onPreview,
}) => {
  const { t, lang } = useLang();
  const { dispatch } = useLanternStudio();
  const thumb = renderWorkThumbnail(work);

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = renderWorkFullImage(work);
    link.download = `lantern_${work.randomId}.png`;
    link.click();
  };

  return (
    <div className="wall-card">
      <img
        className="wall-thumb"
        src={thumb}
        alt={work.randomId}
        onClick={() => onPreview(work)}
      />
      <div className="wall-meta">
        <div className="wall-row">
          <span className="wall-label">{t('lanternId')}</span>
          <span>{work.randomId}</span>
        </div>
        <div className="wall-row">
          <span className="wall-label">{t('createdAt')}</span>
          <span>{formatTime(work.createdAt, lang)}</span>
        </div>
        <div className="wall-actions">
          <button
            type="button"
            className="btn tiny"
            onClick={() => dispatch({ type: 'switchWork', id: work.id })}
          >
            {t('switchTo')}
          </button>
          <button type="button" className="btn tiny" onClick={handleDownload}>
            {t('download')}
          </button>
          <button
            type="button"
            className="btn tiny danger"
            onClick={() => {
              if (window.confirm(t('confirmDelete'))) {
                dispatch({ type: 'removeWork', id: work.id });
              }
            }}
          >
            {t('deleteWork')}
          </button>
        </div>
      </div>
    </div>
  );
};

const LanternWall: React.FC = () => {
  const { t, lang } = useLang();
  const { saved } = useLanternStudio();
  const [preview, setPreview] = useState<LanternWork | null>(null);

  return (
    <section className="lantern-wall">
      <h2 className="wall-title">🏮 {t('collectionWall')}</h2>
      {saved.length === 0 ? (
        <p className="empty-note">{t('emptyWall')}</p>
      ) : (
        <div className="wall-masonry">
          {saved.map((work) => (
            <WallCard key={work.id} work={work} onPreview={setPreview} />
          ))}
        </div>
      )}
      {preview && (
        <div className="preview-overlay" onClick={() => setPreview(null)}>
          <div className="preview-box" onClick={(e) => e.stopPropagation()}>
            <img src={renderWorkFullImage(preview)} alt={preview.randomId} />
            <div className="preview-meta">
              <div>
                {t('lanternId')}: {preview.randomId}
              </div>
              <div>
                {t('createdAt')}: {formatTime(preview.createdAt, lang)}
              </div>
            </div>
            <button type="button" className="btn" onClick={() => setPreview(null)}>
              ×
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

const ShopLayout: React.FC = () => {
  const { t, lang, toggle } = useLang();
  return (
    <div className="shop">
      <header className="shop-header">
        <div className="hanging-lanterns">
          <span className="paper-lantern" />
          <span className="paper-lantern small" />
          <span className="paper-lantern" />
        </div>
        <h1>{t('title')}</h1>
        <p className="subtitle">{t('subtitle')}</p>
        <div className="header-actions">
          <a className="btn small ghost" href="./batch.html">
            {t('batchEntry')}
          </a>
          <button type="button" className="btn small" onClick={toggle}>
            {lang === 'zh' ? 'EN' : '中文'}
          </button>
        </div>
      </header>
      <WorksBar />
      <Workbench t={t} />
      <LanternWall />
    </div>
  );
};

const App: React.FC = () => (
  <LangProvider>
    <LanternStudioProvider>
      <ShopLayout />
    </LanternStudioProvider>
  </LangProvider>
);

export default App;
