import { useState, useEffect, useMemo, useCallback } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import type { Word, PartOfSpeech, SortOrder } from './types';
import { PART_OF_SPEECH_LABELS, PART_OF_SPEECH_COLORS } from './types';
import {
  loadWords,
  saveWords,
  addWord,
  updateMastery,
  recordAnswer,
  filterByParts,
  sortAlphabetically,
  getMostUrgentWords,
  AddWordPayload,
} from './data/words';
import { useQuiz } from './hooks/useQuiz';
import { WordCard } from './components/WordCard';
import { QuizPanel } from './components/QuizPanel';

const PARTS: PartOfSpeech[] = ['noun', 'verb', 'adjective', 'adverb', 'preposition'];

function App() {
  const [words, setWords] = useState<Word[]>([]);
  const [filterParts, setFilterParts] = useState<PartOfSpeech[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEnglish, setNewEnglish] = useState('');
  const [newChinese, setNewChinese] = useState('');
  const [newPos, setNewPos] = useState<PartOfSpeech>('noun');
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const quiz = useQuiz();

  useEffect(() => {
    setWords(loadWords());
  }, []);

  useEffect(() => {
    if (words.length > 0) saveWords(words);
  }, [words]);

  const displayWords = useMemo(() => {
    const filtered = filterByParts(words, filterParts);
    return sortAlphabetically(filtered, sortOrder);
  }, [words, filterParts, sortOrder]);

  const toggleFilterPart = (p: PartOfSpeech) => {
    setFilterParts((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const handleUpdateMastery = useCallback((id: string, mastery: number) => {
    setWords((prev) => updateMastery(prev, id, mastery));
  }, []);

  const handleAnswerRecord = useCallback((wordId: string, correct: boolean) => {
    setWords((prev) => recordAnswer(prev, wordId, correct));
  }, []);

  const handleQuickReview = useCallback(
    (word: Word) => {
      const urgentWords = getMostUrgentWords(words, 10);
      const targetWords = urgentWords.length > 0 ? urgentWords : words.slice(0, 10);
      const config = {
        selectedParts: [] as PartOfSpeech[],
        questionCount: Math.min(10, targetWords.length),
        speed: 'normal' as const,
      };
      quiz.startQuiz(config, targetWords, (id) => setHighlightId(id));
      toast.success(`快速复习模式：优先复习以「${word.english}」为代表的紧迫单词`, {
        duration: 2200,
      });
    },
    [words, quiz],
  );

  const handleQuickReviewFromResult = useCallback(
    (wrongWords: Word[]) => {
      const config = {
        selectedParts: [] as PartOfSpeech[],
        questionCount: wrongWords.length,
        speed: 'normal' as const,
      };
      quiz.startQuiz(config, wrongWords, (id) => setHighlightId(id));
      toast.success(`开始复习 ${wrongWords.length} 个错误单词`, { duration: 2000 });
    },
    [quiz],
  );

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const en = newEnglish.trim();
    const cn = newChinese.trim();
    if (!en || !cn) {
      toast.error('请填写完整的英文和中文释义');
      return;
    }
    if (!/^[a-zA-Z][a-zA-Z\s'-]*$/.test(en)) {
      toast.error('英文单词只能包含字母、空格、连字符或撇号');
      return;
    }
    const payload: AddWordPayload = {
      english: en,
      chinese: cn,
      partOfSpeech: newPos,
    };
    setWords((prev) => addWord(prev, payload));
    setNewEnglish('');
    setNewChinese('');
    setNewPos('noun');
    setShowAddForm(false);
    toast.success(`已添加单词：${en}`);
  };

  const totalCount = words.length;
  const urgentCount = getMostUrgentWords(words, 999).filter(
    (w) => {
      const s = Math.min(100, Math.max(0,
        ((1 - Math.min(1, (Date.now() - w.lastAttemptAt) / (30 * 86400000))) * 0 +
          Math.max(0, (5 - w.mastery) / 4) * 30 +
          Math.min(w.wrongCount / 8, 1) * 25) * 100));
      return s >= 40;
    },
  ).length;

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-header__title-wrap">
          <div className="app-logo">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </div>
          <div>
            <h1 className="app-header__title">智慧单词本</h1>
            <div className="app-header__subtitle">个性化听写训练 · 高效记忆单词</div>
          </div>
        </div>
        <div className="app-header__stats">
          <div className="app-stat">
            <span className="app-stat__value">{totalCount}</span>
            <span className="app-stat__label">总单词</span>
          </div>
          <div className="app-stat">
            <span className="app-stat__value" style={{ color: '#E74C3C' }}>{urgentCount}</span>
            <span className="app-stat__label">需复习</span>
          </div>
        </div>
      </header>

      <main className={`app-main ${quiz.isActive ? 'is-quiz-mode' : ''}`}>
        <section className={`app-col app-col--left ${quiz.isActive ? 'is-shrink' : ''}`}>
          <div className="col-header">
            <div className="col-header__title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16M4 12h16M4 18h7" />
              </svg>
              单词管理
            </div>
            <div className="col-header__sort">
              <button
                type="button"
                className={`sort-btn ${sortOrder === 'asc' ? 'is-active' : ''}`}
                onClick={() => setSortOrder('asc')}
                title="按字母 A→Z"
              >
                A↓Z
              </button>
              <button
                type="button"
                className={`sort-btn ${sortOrder === 'desc' ? 'is-active' : ''}`}
                onClick={() => setSortOrder('desc')}
                title="按字母 Z→A"
              >
                Z↓A
              </button>
              <button
                type="button"
                className="add-btn"
                onClick={() => setShowAddForm((v) => !v)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                添加新单词
              </button>
            </div>
          </div>

          <div className="filter-bar">
            {PARTS.map((p) => {
              const active = filterParts.includes(p);
              const color = PART_OF_SPEECH_COLORS[p];
              return (
                <button
                  key={p}
                  type="button"
                  className={`filter-chip ${active ? 'is-active' : ''}`}
                  onClick={() => toggleFilterPart(p)}
                  style={{
                    borderColor: color,
                    color: active ? '#FFFFFF' : color,
                    background: active ? color : 'transparent',
                  }}
                >
                  {PART_OF_SPEECH_LABELS[p]}
                </button>
              );
            })}
            {filterParts.length > 0 && (
              <button
                type="button"
                className="filter-clear"
                onClick={() => setFilterParts([])}
              >
                清除筛选
              </button>
            )}
          </div>

          {showAddForm && (
            <form className="add-form" onSubmit={handleAddSubmit}>
              <input
                type="text"
                className="add-input"
                placeholder="英文单词"
                value={newEnglish}
                onChange={(e) => setNewEnglish(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <input
                type="text"
                className="add-input"
                placeholder="中文释义"
                value={newChinese}
                onChange={(e) => setNewChinese(e.target.value)}
              />
              <select
                className="add-select"
                value={newPos}
                onChange={(e) => setNewPos(e.target.value as PartOfSpeech)}
              >
                {PARTS.map((p) => (
                  <option key={p} value={p}>
                    {PART_OF_SPEECH_LABELS[p]}
                  </option>
                ))}
              </select>
              <button type="submit" className="add-submit">
                确认添加
              </button>
            </form>
          )}

          <div className="word-list">
            {displayWords.length === 0 ? (
              <div className="empty-state">
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#C8BFAE" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                <div className="empty-state__title">暂无单词</div>
                <div className="empty-state__desc">点击右上角「添加新单词」开始你的第一个单词</div>
              </div>
            ) : (
              displayWords.map((w) => (
                <WordCard
                  key={w.id}
                  word={w}
                  highlight={highlightId === w.id || quiz.highlightId === w.id}
                  onUpdateMastery={handleUpdateMastery}
                  onQuickReview={handleQuickReview}
                />
              ))
            )}
          </div>
        </section>

        <section className={`app-col app-col--right ${quiz.isActive ? 'is-full' : ''}`}>
          <QuizPanel
            allWords={words}
            quiz={quiz}
            highlightId={highlightId}
            onHighlightChange={setHighlightId}
            onAnswerRecord={handleAnswerRecord}
            onQuickReviewFromResult={handleQuickReviewFromResult}
          />
        </section>
      </main>

      <Toaster
        position="top-right"
        toastOptions={{
          duration: 2500,
          style: {
            borderRadius: '8px',
            background: '#FFFFFF',
            color: '#2C3E50',
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
            fontSize: '14px',
          },
        }}
      />
    </div>
  );
}

export default App;
