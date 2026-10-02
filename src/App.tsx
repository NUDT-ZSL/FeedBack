import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import axios from 'axios';
import { Play, RotateCcw, Trophy, Info } from 'lucide-react';
import { TeaSet } from '@/components/TeaSet';
import { FoamCanvas } from '@/components/FoamCanvas';
import { ScorePanel } from '@/components/ScorePanel';
import { Gallery } from '@/components/Gallery';
import { useGameStore } from '@/store/gameStore';
import { useAI } from '@/hooks/useAI';
import type { TeaPattern } from '@/types';

function App() {
  const [mobileGalleryOpen, setMobileGalleryOpen] = useState(false);
  const [showInstructions, setShowInstructions] = useState(true);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiBottleAngle, setAiBottleAngle] = useState(0);
  const teaSetRef = useRef<React.ElementRef<typeof TeaSet>>(null);
  
  const phase = useGameStore(state => state.phase);
  const currentRound = useGameStore(state => state.currentRound);
  const userScore = useGameStore(state => state.userScore);
  const aiScore = useGameStore(state => state.aiScore);
  const currentPattern = useGameStore(state => state.currentPattern);
  const foamAdhesion = useGameStore(state => state.foamAdhesion);
  const foamDuration = useGameStore(state => state.foamDuration);
  
  const startRound = useGameStore(state => state.startRound);
  const setAiScore = useGameStore(state => state.setAiScore);
  const setCurrentPattern = useGameStore(state => state.setCurrentPattern);
  const saveToGallery = useGameStore(state => state.saveToGallery);
  const clearRound = useGameStore(state => state.clearRound);
  const calculateFoam = useGameStore(state => state.calculateFoam);
  const calculateUserScore = useGameStore(state => state.calculateUserScore);
  
  const { generatePerformance, calculateScore } = useAI();

  const triggerConfetti = useCallback(() => {
    if (userScore.total > aiScore.total) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#c49a3c', '#f5e6d3', '#d4a76a'],
      });
    }
  }, [userScore.total, aiScore.total]);

  const handleStartRound = useCallback(() => {
    setShowInstructions(false);
    setAiProgress(0);
    setAiBottleAngle(0);
    startRound();
  }, [startRound]);

  const handlePatternClick = useCallback(async (pattern: TeaPattern, thumbnail: string) => {
    try {
      await axios.post('/api/gallery', {
        pattern,
        thumbnail,
        roundScore: userScore,
      });
    } catch (e) {
      console.log('Save to gallery locally');
    }
    
    saveToGallery({
      pattern,
      thumbnail,
      roundScore: userScore,
    });
    
    confetti({
      particleCount: 50,
      spread: 50,
      origin: { y: 0.5, x: 0.5 },
      colors: ['#c49a3c', '#f5e6d3', '#d4a76a'],
    });
  }, [saveToGallery, userScore]);

  useEffect(() => {
    if (phase !== 'ai_playing') return;
    
    const perf = generatePerformance();
    let progress = 0;
    const startTime = Date.now();
    const duration = perf.delay;
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      progress = Math.min(1, elapsed / duration);
      setAiProgress(progress);
      
      if (progress < 0.4) {
        setAiBottleAngle(Math.sin(progress * Math.PI / 0.4) * 50);
      } else {
        setAiBottleAngle(Math.max(0, 50 - (progress - 0.4) / 0.1 * 50));
      }
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        const score = calculateScore(perf);
        setAiScore(score);
        
        setTimeout(async () => {
          try {
            const res = await axios.get<TeaPattern>('/api/patterns/random');
            setCurrentPattern(res.data);
          } catch (e) {
            const patterns: TeaPattern[] = [
              {
                id: 'fallback',
                type: 'landscape',
                name: '山水清远',
                poem: '空山新雨后，天气晚来秋。\n明月松间照，清泉石上流。',
                paths: [
                  { points: [[10, 70], [30, 40], [50, 55], [70, 35], [90, 50]], strokeWidth: 2 },
                  { points: [[20, 60], [40, 45], [60, 50], [80, 40]], strokeWidth: 1.5 },
                ]
              }
            ];
            setCurrentPattern(patterns[0]);
          }
          
          setTimeout(() => {
            triggerConfetti();
          }, 1500);
        }, 500);
      }
    };
    
    requestAnimationFrame(animate);
    
    return () => {
      setAiProgress(0);
      setAiBottleAngle(0);
    };
  }, [phase, generatePerformance, calculateScore, setAiScore, setCurrentPattern, triggerConfetti]);

  const handleNewRound = () => {
    clearRound();
    setCurrentPattern(null);
    setAiProgress(0);
    setAiBottleAngle(0);
  };

  const phaseText: Record<string, string> = {
    idle: '准备开始',
    pouring: '拖拽汤瓶注水',
    whisking: '在盏内画圈击拂',
    user_done: '完成点茶',
    ai_playing: 'AI对手点茶中...',
    scoring: '评分中...',
    pattern_showing: '分茶图案浮现',
  };

  return (
    <div className="min-h-screen flex teahouse-bg">
      <div className="flex-1 flex flex-col min-w-0">
        <header className="p-4 flex items-center justify-between border-b border-amber-900/20 bg-amber-50/50 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <h1 className="font-title text-2xl text-amber-900">宋代斗茶</h1>
            <span className="px-3 py-1 rounded-full bg-amber-200/50 text-amber-800 text-sm font-kai">
              第 {currentRound} 回合
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block px-4 py-2 bg-amber-100/80 rounded-lg text-amber-900 font-kai text-sm">
              {phaseText[phase]}
            </div>
            <button
              className="interactive-btn p-2 rounded-lg bg-amber-100/80 text-amber-900"
              onClick={() => setShowInstructions(true)}
            >
              <Info size={20} />
            </button>
            {phase === 'pattern_showing' && (
              <button
                className="interactive-btn flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white font-kai"
                onClick={handleNewRound}
              >
                <RotateCcw size={18} />
                再来一局
              </button>
            )}
          </div>
        </header>
        
        <main className="flex-1 relative flex items-center justify-center p-4">
          <div className="absolute inset-x-0 top-0 h-32 flex justify-around px-8 pointer-events-none">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="scroll-painting w-20 h-28 -mt-2"
                style={{ transform: `translateY(${i * 3}px)` }}
              >
                <div className="w-full h-full flex items-center justify-center">
                  <span className="font-kai text-2xl text-amber-900/60">
                    {['茶', '道', '禅'][i]}
                  </span>
                </div>
              </div>
            ))}
          </div>
          
          <div className="absolute top-0 left-1/4 w-32 h-full bamboo-curtain opacity-60 pointer-events-none" />
          <div className="absolute top-0 right-1/4 w-32 h-full bamboo-curtain opacity-60 pointer-events-none" />
          
          <div className="absolute top-20 left-1/3 w-40 h-40 warm-light pointer-events-none" />
          <div className="absolute top-24 right-1/3 w-32 h-32 warm-light pointer-events-none" />
          
          <div
            className="absolute bottom-20 left-1/2 -translate-x-1/2 w-[600px] max-w-[90vw] h-48 rounded-xl"
            style={{
              background: 'linear-gradient(180deg, #3a2515 0%, #2a1a0e 50%, #1a0f08 100%)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5), inset 0 2px 10px rgba(255,200,120,0.1)',
            }}
          >
            <div
              className="absolute inset-2 rounded-lg"
              style={{
                background: 'linear-gradient(180deg, rgba(196,154,60,0.1) 0%, transparent 100%)',
                border: '1px solid rgba(196,154,60,0.2)',
              }}
            />
          </div>
          
          <div className="relative z-10 w-full max-w-3xl">
            <div
              className="relative mx-auto"
              style={{ width: '500px', height: '350px', maxWidth: '100%' }}
            >
              <TeaSet ref={teaSetRef} />
              
              <div className="absolute inset-0 pointer-events-none">
                <FoamCanvas onPatternClick={handlePatternClick} />
              </div>
              
              {phase === 'ai_playing' && (
                <div className="absolute top-4 right-4 flex items-center gap-2 bg-amber-100/90 px-3 py-2 rounded-lg">
                  <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-sm font-kai text-amber-900">AI操作中</span>
                  <div className="w-20 h-2 bg-amber-200 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-amber-600 rounded-full"
                      style={{ width: `${aiProgress * 100}%` }}
                    />
                  </div>
                </div>
              )}
              
              {phase === 'ai_playing' && aiBottleAngle > 5 && (
                <div
                  className="absolute water-stream pointer-events-none"
                  style={{
                    right: '22%',
                    top: '15%',
                    width: `${3 + aiBottleAngle * 0.08}px`,
                    height: '80px',
                    transform: `translateX(-50%) rotate(${aiBottleAngle * 0.4}deg)`,
                    transformOrigin: 'top center',
                    borderRadius: '2px',
                    opacity: aiBottleAngle / 50 * 0.8,
                  }}
                />
              )}
            </div>
            
            <ScorePanel
              side="left"
              title="您的点茶"
              score={userScore}
              isActive={phase !== 'idle' && phase !== 'pouring' && phase !== 'whisking'}
            />
            
            <ScorePanel
              side="right"
              title="AI对手"
              score={aiScore}
              isActive={phase === 'ai_playing' || phase === 'scoring' || phase === 'pattern_showing'}
            />
          </div>
          
          {phase === 'scoring' && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 text-center">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 text-xl text-amber-900"
              >
                <Trophy className="text-amber-500" size={24} />
                <span className="font-title">
                  {userScore.total > aiScore.total
                    ? '恭喜获胜！'
                    : userScore.total === aiScore.total
                    ? '平局！'
                    : '再接再厉！'}
                </span>
              </motion.div>
            </div>
          )}
        </main>
        
        <div className="p-4 text-center border-t border-amber-900/10 bg-amber-50/50">
          <p className="text-xs font-kai text-amber-700/70">
            宋代建安斗茶 · 点茶击拂 · 分茶百戏
          </p>
        </div>
      </div>
      
      <div className="hidden md:block">
        <Gallery isMobileOpen={mobileGalleryOpen} onToggleMobile={() => setMobileGalleryOpen(!mobileGalleryOpen)} />
      </div>
      
      <div className="md:hidden">
        <Gallery isMobileOpen={mobileGalleryOpen} onToggleMobile={() => setMobileGalleryOpen(!mobileGalleryOpen)} />
      </div>
      
      <AnimatePresence>
        {showInstructions && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowInstructions(false)}
          >
            <motion.div
              className="relative bg-amber-50 rounded-2xl p-8 max-w-lg w-full"
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="font-title text-3xl text-amber-900 text-center mb-6">
                宋代斗茶
              </h2>
              
              <div className="space-y-4 font-kai text-amber-800">
                <div className="bg-amber-100/50 rounded-lg p-4">
                  <h3 className="font-bold text-amber-900 mb-2">点茶三步</h3>
                  <ol className="list-decimal list-inside space-y-2 text-sm">
                    <li><strong>注水</strong>：拖拽青瓷汤瓶，倾斜角度控制水流大小</li>
                    <li><strong>击拂</strong>：用茶筅在盏内画圈，速度越快沫饽越细腻</li>
                    <li><strong>斗茶</strong>：与AI比拼沫饽色泽、持久度、咬盏程度</li>
                  </ol>
                </div>
                
                <div className="bg-amber-100/50 rounded-lg p-4">
                  <h3 className="font-bold text-amber-900 mb-2">评分标准</h3>
                  <ul className="space-y-1 text-sm">
                    <li><strong>沫饽色泽</strong>：以纯白 `#faf5e8` 为最佳</li>
                    <li><strong>持久度</strong>：沫饽消退至50%所需时间</li>
                    <li><strong>咬盏程度</strong>：沫饽紧贴盏壁，无明显水线</li>
                  </ul>
                </div>
                
                <div className="bg-amber-100/50 rounded-lg p-4">
                  <h3 className="font-bold text-amber-900 mb-2">分茶百戏</h3>
                  <p className="text-sm">
                    每轮比赛结束后，茶汤表面会浮现一幅分茶图案。
                    <br />点击图案即可保存到图鉴库（最多20幅）。
                  </p>
                </div>
              </div>
              
              {phase === 'idle' && (
                <button
                  className="interactive-btn w-full mt-6 py-4 rounded-xl bg-gradient-to-r from-amber-600 to-amber-700 text-white font-title text-xl flex items-center justify-center gap-3"
                  onClick={handleStartRound}
                >
                  <Play size={24} />
                  开始斗茶
                </button>
              )}
              
              {phase !== 'idle' && (
                <button
                  className="interactive-btn w-full mt-6 py-3 rounded-xl bg-amber-200 text-amber-900 font-kai"
                  onClick={() => setShowInstructions(false)}
                >
                  继续比赛
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {phase === 'idle' && !showInstructions && (
        <motion.div
          className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <button
            className="interactive-btn pointer-events-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-600 to-amber-700 text-white font-title text-2xl flex items-center gap-3 shadow-2xl"
            onClick={handleStartRound}
          >
            <Play size={28} />
            开始斗茶
          </button>
        </motion.div>
      )}
    </div>
  );
}

export default App;
