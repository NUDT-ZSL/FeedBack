import { useState, useCallback, useMemo } from 'react';
import type { Question, UserProfile, Page, PlayerScore } from './types';
import QuizPage from './QuizPage';
import Leaderboard from './Leaderboard';

const AVATARS = ['🐱', '🐶', '🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🐵', '🐰'];

export default function App() {
  const [page, setPage] = useState<Page>('welcome');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [startTime, setStartTime] = useState<number>(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadQuestions = useCallback(async () => {
    try {
      const res = await fetch('/api/questions');
      const data: Question[] = await res.json();
      setQuestions(data);
    } catch (err) {
      console.error('加载题目失败:', err);
    }
  }, []);

  const handleStart = useCallback(async (nickname: string, avatar: number) => {
    setProfile({ nickname, avatar });
    setCurrentIndex(0);
    setScore(0);
    setCorrectCount(0);
    setQuizCompleted(false);
    setElapsedSeconds(0);
    setStartTime(Date.now());
    await loadQuestions();
    setPage('quiz');
  }, [loadQuestions]);

  const handleAnswer = useCallback((selectedIndex: number, isCorrect: boolean) => {
    if (isCorrect) {
      setScore(prev => prev + 10);
      setCorrectCount(prev => prev + 1);
    }
  }, []);

  const handleNext = useCallback(() => {
    if (currentIndex + 1 >= questions.length) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedSeconds(elapsed);
      setQuizCompleted(true);
      submitScore(elapsed);
    } else {
      setCurrentIndex(prev => prev + 1);
    }
  }, [currentIndex, questions.length, startTime]);

  const submitScore = useCallback(async (timeSec: number) => {
    if (!profile) return;
    setSubmitting(true);
    try {
      await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: profile.nickname,
          avatar: profile.avatar,
          score,
          timeInSeconds: timeSec
        })
      });
    } catch (err) {
      console.error('提交分数失败:', err);
    } finally {
      setSubmitting(false);
    }
  }, [profile, score]);

  const handlePlayAgain = useCallback(async () => {
    setCurrentIndex(0);
    setScore(0);
    setCorrectCount(0);
    setQuizCompleted(false);
    setElapsedSeconds(0);
    setStartTime(Date.now());
    await loadQuestions();
    setPage('quiz');
  }, [loadQuestions]);

  const handleRestart = useCallback(() => {
    setPage('welcome');
    setProfile(null);
    setQuestions([]);
    setCurrentIndex(0);
    setScore(0);
    setCorrectCount(0);
    setQuizCompleted(false);
    setElapsedSeconds(0);
  }, []);

  const activeNav = useMemo(() => {
    if (page === 'leaderboard') return 'leaderboard';
    return 'quiz';
  }, [page]);

  return (
    <div className="app-container">
      <nav className="navbar">
        <div className="navbar-title">
          <span className="emoji">🧠</span>
          <span>知识问答竞赛</span>
        </div>
        <div className="navbar-buttons">
          {profile && page !== 'welcome' && (
            <>
              <button
                className={`nav-btn ${activeNav === 'quiz' ? 'active' : ''}`}
                onClick={() => setPage('quiz')}
              >
                {quizCompleted ? '答题结果' : '继续答题'}
              </button>
              <button
                className={`nav-btn ${activeNav === 'leaderboard' ? 'active' : ''}`}
                onClick={() => setPage('leaderboard')}
              >
                排行榜
              </button>
            </>
          )}
        </div>
      </nav>

      <main className="page-content">
        {page === 'welcome' && (
          <WelcomePage avatars={AVATARS} onStart={handleStart} />
        )}
        {page === 'quiz' && profile && (
          <QuizPage
            questions={questions}
            currentIndex={currentIndex}
            score={score}
            correctCount={correctCount}
            startTime={startTime}
            elapsedSeconds={elapsedSeconds}
            quizCompleted={quizCompleted}
            submitting={submitting}
            profile={profile}
            avatars={AVATARS}
            onAnswer={handleAnswer}
            onNext={handleNext}
            onPlayAgain={handlePlayAgain}
            onRestart={handleRestart}
          />
        )}
        {page === 'leaderboard' && (
          <Leaderboard avatars={AVATARS} />
        )}
      </main>
    </div>
  );
}

interface WelcomePageProps {
  avatars: string[];
  onStart: (nickname: string, avatar: number) => void;
}

function WelcomePage({ avatars, onStart }: WelcomePageProps) {
  const [nickname, setNickname] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(0);
  const [loading, setLoading] = useState(false);

  const canStart = nickname.trim().length >= 2;

  const handleSubmit = async () => {
    if (!canStart) return;
    setLoading(true);
    await onStart(nickname.trim(), selectedAvatar);
    setLoading(false);
  };

  return (
    <div className="welcome-container">
      <div className="welcome-card">
        <h1 className="welcome-title">🎮 知识问答挑战</h1>
        <p className="welcome-subtitle">测试你的知识储备，登上排行榜顶端！</p>

        <div className="form-group">
          <label className="form-label">输入昵称</label>
          <input
            type="text"
            className="form-input"
            placeholder="请输入你的昵称（至少2个字符）"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
            maxLength={20}
          />
        </div>

        <div className="form-group">
          <label className="form-label">选择头像</label>
          <div className="avatar-grid">
            {avatars.map((emoji, idx) => (
              <div
                key={idx}
                className={`avatar-item ${selectedAvatar === idx ? 'selected' : ''}`}
                onClick={() => setSelectedAvatar(idx)}
              >
                {emoji}
              </div>
            ))}
          </div>
        </div>

        <button
          className="start-btn"
          onClick={handleSubmit}
          disabled={!canStart || loading}
        >
          {loading ? '加载中...' : '🚀 开始挑战'}
        </button>
      </div>
    </div>
  );
}
