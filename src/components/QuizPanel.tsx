import { useState, useEffect, useRef, useCallback } from 'react';
import type { Word, PartOfSpeech, SpeechSpeed, QuizResult as QuizResultType, QuizConfig } from '../types';
import { PART_OF_SPEECH_LABELS, PART_OF_SPEECH_COLORS, SPEECH_SPEED_LABELS } from '../types';
import type { QuizHook } from '../hooks/useQuiz';

interface QuizPanelProps {
  allWords: Word[];
  quiz: QuizHook;
  highlightId: string | null;
  onHighlightChange: (id: string | null) => void;
  onAnswerRecord: (wordId: string, correct: boolean) => void;
  onQuickReviewFromResult: (words: Word[]) => void;
}

const PARTS: PartOfSpeech[] = ['noun', 'verb', 'adjective', 'adverb', 'preposition'];
const SPEEDS: SpeechSpeed[] = ['slow', 'normal', 'fast'];

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}分${sec}秒` : `${sec}秒`;
}

export const QuizPanel = ({
  allWords,
  quiz,
  onAnswerRecord,
  onQuickReviewFromResult,
}: QuizPanelProps) => {
  const [selectedParts, setSelectedParts] = useState<PartOfSpeech[]>([]);
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [speed, setSpeed] = useState<SpeechSpeed>('normal');
  const [input, setInput] = useState('');
  const [locked, setLocked] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [report, setReport] = useState<QuizResultType | null>(null);
  const [navEntered, setNavEntered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const onHighlightRef = useRef<(id: string | null) => void>(() => undefined);

  useEffect(() => {
    setNavEntered(quiz.isActive);
  }, [quiz.isActive]);

  useEffect(() => {
    if (quiz.isActive && !quiz.isFinished && inputRef.current && !locked) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [quiz.currentIndex, quiz.isActive, quiz.isFinished, locked]);

  useEffect(() => {
    if (quiz.isFinished && !showReport) {
      const r = quiz.finishQuiz();
      setReport(r);
      setShowReport(true);
    }
  }, [quiz.isFinished, quiz, showReport]);

  const setOnHighlight = useCallback((fn: (id: string | null) => void) => {
    onHighlightRef.current = fn;
  }, []);

  const handleTogglePart = (p: PartOfSpeech) => {
    setSelectedParts((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const handleStart = () => {
    const available =
      selectedParts.length === 0
        ? allWords
        : allWords.filter((w) => selectedParts.includes(w.partOfSpeech));
    if (available.length === 0) return;
    setInput('');
    setLocked(false);
    setShowReport(false);
    setReport(null);
    const config: QuizConfig = {
      selectedParts,
      questionCount,
      speed,
    };
    quiz.startQuiz(config, available, (id) => {
      onHighlightRef.current(id);
    });
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (locked || !quiz.currentWord) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    setLocked(true);
    const result = quiz.submitAnswer(trimmed, speed, (id) => onHighlightRef.current(id));
    if (result.word) {
      onAnswerRecord(result.word.id, result.correct);
    }
    setTimeout(() => {
      setInput('');
      setLocked(false);
    }, 1200);
  };

  const handleReplay = () => {
    quiz.replayCurrent(speed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  const handleCloseReport = () => {
    setShowReport(false);
    setReport(null);
    quiz.resetQuiz();
  };

  const handleRetry = () => {
    setShowReport(false);
    setReport(null);
    quiz.resetQuiz();
    setTimeout(handleStart, 100);
  };

  const handleReviewWrong = () => {
    if (!report || report.wrongWords.length === 0) return;
    setShowReport(false);
    setReport(null);
    quiz.resetQuiz();
    onQuickReviewFromResult(report.wrongWords);
  };

  // --- 渲染：配置面板 ---
  if (!quiz.isActive) {
    const availableCount =
      selectedParts.length === 0
        ? allWords.length
        : allWords.filter((w) => selectedParts.includes(w.partOfSpeech)).length;

    return (
      <div className="quiz-panel">
        <div className="quiz-panel__header">
          <h2 className="quiz-panel__title">听写配置</h2>
          <p className="quiz-panel__subtitle">设置参数后开始个性化听写测验</p>
        </div>

        <div className="quiz-section">
          <div className="quiz-section__label">选择词性分类</div>
          <div className="quiz-parts">
            {PARTS.map((p) => {
              const active = selectedParts.includes(p);
              const color = PART_OF_SPEECH_COLORS[p];
              return (
                <button
                  key={p}
                  type="button"
                  className={`quiz-part ${active ? 'is-active' : ''}`}
                  onClick={() => handleTogglePart(p)}
                  style={{
                    borderColor: active ? color : '#E5E0D6',
                    background: active ? `${color}18` : '#FFFFFF',
                    color: active ? color : '#7A7A7A',
                  }}
                >
                  <span className="quiz-part__dot" style={{ background: color }} />
                  {PART_OF_SPEECH_LABELS[p]}
                </button>
              );
            })}
          </div>
          {selectedParts.length === 0 && (
            <div className="quiz-panel__hint">不选则从所有单词中抽取</div>
          )}
        </div>

        <div className="quiz-section">
          <div className="quiz-section__row">
            <div className="quiz-section__label">题目数量</div>
            <div className="quiz-count-value">{questionCount} 题</div>
          </div>
          <input
            type="range"
            min={5}
            max={20}
            step={1}
            value={questionCount}
            onChange={(e) => setQuestionCount(Number(e.target.value))}
            className="quiz-slider"
          />
          <div className="quiz-slider__labels">
            <span>5</span>
            <span>20</span>
          </div>
        </div>

        <div className="quiz-section">
          <div className="quiz-section__label">播放速度</div>
          <div className="quiz-speeds">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={`quiz-speed ${speed === s ? 'is-active' : ''}`}
                onClick={() => setSpeed(s)}
              >
                {SPEECH_SPEED_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="quiz-start-btn"
          onClick={handleStart}
          disabled={availableCount === 0}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span>开始听写（{Math.min(questionCount, availableCount)} 题）</span>
        </button>
      </div>
    );
  }

  // --- 渲染：得分报告模态框 ---
  const renderReport = () => {
    if (!showReport || !report) return null;
    return (
      <div className="modal-overlay" onClick={handleCloseReport}>
        <div
          className={`modal-card ${showReport ? 'is-visible' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-card__header">
            <div className="modal-card__title">听写完成！</div>
            <button type="button" className="modal-card__close" onClick={handleCloseReport}>
              ×
            </button>
          </div>

          <div className="modal-score">
            <div className="modal-score__ring" style={{
              background: `conic-gradient(#2C3E50 ${report.accuracy * 3.6}deg, #EAE3D5 0deg)`,
            }}>
              <div className="modal-score__inner">
                <div className="modal-score__value">{report.accuracy}</div>
                <div className="modal-score__unit">%</div>
              </div>
            </div>
          </div>

          <div className="modal-stats">
            <div className="modal-stat">
              <div className="modal-stat__label">正确数</div>
              <div className="modal-stat__value" style={{ color: '#50B86C' }}>
                {report.correctCount}/{report.totalQuestions}
              </div>
            </div>
            <div className="modal-stat">
              <div className="modal-stat__label">用时</div>
              <div className="modal-stat__value" style={{ color: '#4A90D9' }}>
                {formatDuration(report.durationMs)}
              </div>
            </div>
            <div className="modal-stat">
              <div className="modal-stat__label">错误数</div>
              <div className="modal-stat__value" style={{ color: '#E74C3C' }}>
                {report.wrongWords.length}
              </div>
            </div>
          </div>

          {report.wrongWords.length > 0 && (
            <div className="modal-wrong-list">
              <div className="modal-wrong-list__title">错误单词</div>
              <div className="modal-wrong-list__items">
                {report.wrongWords.map((w) => (
                  <div key={w.id} className="modal-wrong-item">
                    <span className="modal-wrong-item__en">{w.english}</span>
                    <span className="modal-wrong-item__cn">{w.chinese}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="modal-btn modal-btn--ghost" onClick={handleCloseReport}>
              返回管理
            </button>
            {report.wrongWords.length > 0 && (
              <button
                type="button"
                className="modal-btn modal-btn--warn"
                onClick={handleReviewWrong}
              >
                仅复习错误
              </button>
            )}
            <button type="button" className="modal-btn modal-btn--primary" onClick={handleRetry}>
              再来一次
            </button>
          </div>
        </div>
      </div>
    );
  };

  // --- 渲染：听写答题界面 ---
  const feedbackClass =
    quiz.feedback.state === 'correct'
      ? 'is-correct'
      : quiz.feedback.state === 'wrong'
        ? 'is-wrong'
        : '';

  return (
    <div className="quiz-panel">
      <div className={`quiz-nav ${navEntered ? 'is-in' : ''}`}>
        <button type="button" className="quiz-nav__back" onClick={handleCloseReport}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>结束测验</span>
        </button>
        <div className="quiz-nav__progress">
          <div className="quiz-nav__progress-text">
            {Math.min(quiz.currentIndex + 1, quiz.totalQuestions)} / {quiz.totalQuestions}
          </div>
          <div className="quiz-nav__progress-bar">
            <div
              className="quiz-nav__progress-fill"
              style={{ width: `${quiz.progress}%` }}
            />
          </div>
        </div>
      </div>

      <div className="quiz-active">
        <div className="quiz-active__hint">
          听发音 · 拼写单词
        </div>

        {quiz.currentWord && (
          <div className="quiz-active__chinese">
            提示：{quiz.currentWord.chinese}
            <span
              className="quiz-active__pos"
              style={{ background: PART_OF_SPEECH_COLORS[quiz.currentWord.partOfSpeech] }}
            >
              {PART_OF_SPEECH_LABELS[quiz.currentWord.partOfSpeech]}
            </span>
          </div>
        )}

        <button type="button" className="quiz-play-btn" onClick={handleReplay}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
          <span>再听一遍 ({SPEECH_SPEED_LABELS[speed]})</span>
        </button>

        <form className="quiz-form" onSubmit={handleSubmit}>
          <div className={`quiz-input-wrap ${feedbackClass}`}>
            <input
              ref={inputRef}
              type="text"
              className="quiz-input"
              placeholder="输入英文单词拼写..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={locked}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            {quiz.feedback.state === 'correct' && (
              <span className="quiz-input__icon quiz-input__icon--ok">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            )}
            {quiz.feedback.state === 'wrong' && (
              <span className="quiz-input__icon quiz-input__icon--err">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </span>
            )}
          </div>
          {quiz.feedback.state === 'wrong' && quiz.feedback.correctSpelling && (
            <div className="quiz-correct-hint">
              正确拼写：<strong>{quiz.feedback.correctSpelling}</strong>
            </div>
          )}
          <button
            type="submit"
            className="quiz-submit-btn"
            disabled={locked || !input.trim()}
          >
            提交答案
          </button>
        </form>
      </div>

      {/* 占位：为了满足 setOnHighlight 引用 */}
      <div style={{ display: 'none' }} ref={() => setOnHighlight(() => undefined)} />

      {renderReport()}
    </div>
  );
};
