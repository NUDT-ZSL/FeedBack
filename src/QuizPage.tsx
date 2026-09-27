import { useState, useEffect, useRef } from 'react';
import type { Question, UserProfile } from './types';

interface QuizPageProps {
  questions: Question[];
  currentIndex: number;
  score: number;
  correctCount: number;
  startTime: number;
  elapsedSeconds: number;
  quizCompleted: boolean;
  submitting: boolean;
  profile: UserProfile;
  avatars: string[];
  onAnswer: (selectedIndex: number, isCorrect: boolean) => void;
  onNext: () => void;
  onPlayAgain: () => void;
  onRestart: () => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

export default function QuizPage(props: QuizPageProps) {
  const {
    questions,
    currentIndex,
    score,
    correctCount,
    startTime,
    elapsedSeconds,
    quizCompleted,
    submitting,
    profile,
    avatars,
    onAnswer,
    onNext,
    onPlayAgain,
    onRestart,
  } = props;

  const [selected, setSelected] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const answeredRef = useRef(false);

  useEffect(() => {
    if (quizCompleted) return;
    const timer = setInterval(() => {
      setCurrentTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime, quizCompleted]);

  useEffect(() => {
    setSelected(null);
    setShowResult(false);
    answeredRef.current = false;
  }, [currentIndex]);

  const handleSelect = (index: number) => {
    if (showResult || answeredRef.current) return;
    answeredRef.current = true;
    setSelected(index);
    setShowResult(true);

    const question = questions[currentIndex];
    const isCorrect = index === question.correctIndex;
    onAnswer(index, isCorrect);

    setTimeout(() => {
      setTransitioning(true);
      setTimeout(() => {
        setTransitioning(false);
        onNext();
      }, 300);
    }, 800);
  };

  const displayTime = quizCompleted ? elapsedSeconds : currentTime;

  if (quizCompleted) {
    return (
      <ResultPage
        score={score}
        correctCount={correctCount}
        totalQuestions={questions.length}
        elapsedSeconds={elapsedSeconds}
        submitting={submitting}
        profile={profile}
        avatars={avatars}
        onPlayAgain={onPlayAgain}
        onRestart={onRestart}
      />
    );
  }

  if (questions.length === 0) {
    return (
      <div className="loading-container">
        <div className="spinner" />
        <p className="loading-text">正在加载题目...</p>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];

  return (
    <div className="quiz-container">
      <div className="quiz-header">
        <span className="quiz-progress">
          题目 {currentIndex + 1} / {questions.length}
        </span>
        <span className="quiz-time">⏱ {formatTime(displayTime)}</span>
        <span className="quiz-score">🏆 {score} 分</span>
      </div>

      <div className={transitioning ? 'fade-wrapper' : ''}>
        <div
          key={currentIndex}
          className={`quiz-card ${transitioning ? '' : 'fade-enter'}`}
        >
          <div className="question-number">
            第 {currentIndex + 1} 题
          </div>
          <div className="question-text">{currentQuestion.question}</div>
          <div className="options-container">
            {currentQuestion.options.map((option, idx) => {
              let btnClass = 'option-btn';
              if (showResult) {
                if (idx === currentQuestion.correctIndex) {
                  btnClass += ' correct';
                } else if (idx === selected && idx !== currentQuestion.correctIndex) {
                  btnClass += ' wrong';
                }
              } else if (selected === idx) {
                btnClass += ' selected';
              }

              return (
                <button
                  key={idx}
                  className={btnClass}
                  onClick={() => handleSelect(idx)}
                  disabled={showResult}
                >
                  <span className="option-label">{OPTION_LABELS[idx]}</span>
                  <span>{option}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

interface ResultPageProps {
  score: number;
  correctCount: number;
  totalQuestions: number;
  elapsedSeconds: number;
  submitting: boolean;
  profile: UserProfile;
  avatars: string[];
  onPlayAgain: () => void;
  onRestart: () => void;
}

function ResultPage(props: ResultPageProps) {
  const {
    score,
    correctCount,
    totalQuestions,
    elapsedSeconds,
    submitting,
    profile,
    avatars,
    onPlayAgain,
    onRestart,
  } = props;

  const percentage = (correctCount / totalQuestions) * 100;
  let titleType: 'good' | 'medium' | 'bad' = 'bad';
  let title = '再接再厉！';
  let emoji = '💪';

  if (percentage >= 80) {
    titleType = 'good';
    title = '太棒了！';
    emoji = '🎉';
  } else if (percentage >= 50) {
    titleType = 'medium';
    title = '还不错！';
    emoji = '👍';
  }

  return (
    <div className="result-container">
      <div className="result-card">
        <div className="result-emoji">{emoji}</div>
        <h2 className={`result-title ${titleType}`}>{title}</h2>
        <p className="result-subtitle">
          {profile.nickname}，你完成了所有题目！
          {submitting && ' 正在上传成绩...'}
        </p>

        <div className="result-stats">
          <div className="result-stat">
            <div className="result-stat-label">最终得分</div>
            <div className="result-stat-value score">{score}</div>
          </div>
          <div className="result-stat">
            <div className="result-stat-label">用时</div>
            <div className="result-stat-value time">
              {formatTime(elapsedSeconds)}
            </div>
          </div>
          <div className="result-stat" style={{ gridColumn: '1 / -1' }}>
            <div className="result-stat-label">正确率</div>
            <div className="result-stat-value correct">
              {correctCount} / {totalQuestions} ({percentage.toFixed(0)}%)
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            marginBottom: 24,
            padding: 16,
            backgroundColor: '#0f172a',
            borderRadius: 16,
            border: '1px solid #334155',
          }}
        >
          <div className="player-avatar" style={{ width: 48, height: 48, fontSize: 26 }}>
            {avatars[profile.avatar]}
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 2 }}>玩家</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#e2e8f0' }}>
              {profile.nickname}
            </div>
          </div>
        </div>

        <button className="result-btn" onClick={onPlayAgain} disabled={submitting}>
          🔄 再来一局
        </button>
        <button
          className="result-btn secondary"
          onClick={onRestart}
          disabled={submitting}
        >
          👤 切换账号
        </button>
      </div>
    </div>
  );
}
