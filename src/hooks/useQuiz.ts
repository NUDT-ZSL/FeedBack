import { useState, useRef, useCallback, useEffect } from 'react';
import type { Word, QuizConfig, QuizResult, QuizAnswer, FeedbackInfo, FeedbackState, SpeechSpeed } from '../types';
import { SPEECH_SPEED_VALUES } from '../types';
import { shuffleArray } from '../data/words';

export interface UseQuizState {
  isActive: boolean;
  quizWords: Word[];
  currentIndex: number;
  highlightId: string | null;
  feedback: FeedbackInfo;
  startTime: number;
  answers: QuizAnswer[];
}

const initialState: UseQuizState = {
  isActive: false,
  quizWords: [],
  currentIndex: 0,
  highlightId: null,
  feedback: { state: 'idle' },
  startTime: 0,
  answers: [],
};

export const useQuiz = () => {
  const [state, setState] = useState<UseQuizState>(initialState);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voicesReadyRef = useRef(false);

  const currentWord: Word | null = state.quizWords[state.currentIndex] ?? null;
  const isFinished = state.isActive && state.currentIndex >= state.quizWords.length;

  useEffect(() => {
    const ensureVoices = () => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      window.speechSynthesis.getVoices();
      voicesReadyRef.current = true;
    };
    ensureVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = ensureVoices;
    }
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  const getEnglishVoice = useCallback((): SpeechSynthesisVoice | null => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      (v) => /en[-_](US|GB)/i.test(v.lang) && v.localService,
    );
    if (preferred) return preferred;
    return voices.find((v) => v.lang.toLowerCase().startsWith('en')) ?? null;
  }, []);

  const speakWord = useCallback(
    (text: string, speed: SpeechSpeed) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'en-US';
        utter.rate = SPEECH_SPEED_VALUES[speed];
        utter.pitch = 1;
        const voice = getEnglishVoice();
        if (voice) utter.voice = voice;
        utteranceRef.current = utter;
        window.speechSynthesis.speak(utter);
      } catch {
        // ignore speech errors
      }
    },
    [getEnglishVoice],
  );

  const startQuiz = useCallback(
    (config: QuizConfig, availableWords: Word[], onHighlight: (id: string) => void) => {
      if (availableWords.length === 0) return;

      let pool = availableWords;
      if (config.selectedParts.length > 0) {
        const partSet = new Set(config.selectedParts);
        pool = availableWords.filter((w) => partSet.has(w.partOfSpeech));
      }
      if (pool.length === 0) pool = availableWords;

      const target = Math.min(config.questionCount, pool.length);
      const picked = shuffleArray(pool).slice(0, target);

      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.getVoices();
      }

      setState({
        isActive: true,
        quizWords: picked,
        currentIndex: 0,
        highlightId: picked[0]?.id ?? null,
        feedback: { state: 'idle' },
        startTime: Date.now(),
        answers: [],
      });

      if (picked[0]) {
        onHighlight(picked[0].id);
        setTimeout(() => {
          speakWord(picked[0].english, config.speed);
        }, 80);
      }
    },
    [speakWord],
  );

  const submitAnswer = useCallback(
    (input: string, speed: SpeechSpeed, onHighlight: (id: string | null) => void): { correct: boolean; word: Word | null; last: boolean } => {
      const word = currentWord;
      if (!word) return { correct: false, word: null, last: true };

      const normalizedInput = input.trim().toLowerCase();
      const correct = normalizedInput === word.english.toLowerCase();

      const answerRecord: QuizAnswer = {
        wordId: word.id,
        english: word.english,
        userInput: input,
        correct,
      };

      const feedback: FeedbackInfo = correct
        ? { state: 'correct' }
        : { state: 'wrong', correctSpelling: word.english };

      setState((prev) => ({
        ...prev,
        feedback,
        answers: [...prev.answers, answerRecord],
      }));

      const last = state.currentIndex + 1 >= state.quizWords.length;

      setTimeout(() => {
        setState((prev) => {
          const nextIndex = prev.currentIndex + 1;
          const nextWord = prev.quizWords[nextIndex] ?? null;
          if (nextWord) {
            onHighlight(nextWord.id);
            setTimeout(() => speakWord(nextWord.english, speed), 300);
          } else {
            onHighlight(null);
          }
          return {
            ...prev,
            currentIndex: nextIndex,
            feedback: { state: 'idle' },
            highlightId: nextWord?.id ?? null,
          };
        });
      }, 1200);

      return { correct, word, last };
    },
    [currentWord, state.currentIndex, state.quizWords.length, speakWord],
  );

  const replayCurrent = useCallback(
    (speed: SpeechSpeed) => {
      if (currentWord) speakWord(currentWord.english, speed);
    },
    [currentWord, speakWord],
  );

  const finishQuiz = useCallback((): QuizResult => {
    const correctCount = state.answers.filter((a) => a.correct).length;
    const total = state.answers.length;
    const wrongIds = new Set(state.answers.filter((a) => !a.correct).map((a) => a.wordId));
    const wrongWords = state.quizWords.filter((w) => wrongIds.has(w.id));
    return {
      totalQuestions: total,
      correctCount,
      accuracy: total === 0 ? 0 : Math.round((correctCount / total) * 100),
      durationMs: Date.now() - state.startTime,
      answers: state.answers,
      wrongWords,
    };
  }, [state.answers, state.quizWords, state.startTime]);

  const resetQuiz = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setState(initialState);
  }, []);

  const setFeedbackState = useCallback((fb: FeedbackState) => {
    setState((prev) => ({ ...prev, feedback: { state: fb } }));
  }, []);

  return {
    ...state,
    currentWord,
    isFinished,
    totalQuestions: state.quizWords.length,
    progress: state.quizWords.length === 0 ? 0 : (state.currentIndex / state.quizWords.length) * 100,
    startQuiz,
    submitAnswer,
    replayCurrent,
    finishQuiz,
    resetQuiz,
    setFeedbackState,
    speakWord,
  };
};

export type QuizHook = ReturnType<typeof useQuiz>;
