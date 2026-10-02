import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import Mirror from '@/components/Mirror';
import GrindingStone from '@/components/GrindingStone';
import DeerSkin from '@/components/DeerSkin';
import OilLamp from '@/components/OilLamp';
import ProgressPanel from '@/components/ProgressPanel';
import { useGrindingStore } from '@/store/useGrindingStore';
import { GritType } from '@/types';

const App: React.FC = () => {
  const mirrorRef = useRef<HTMLDivElement>(null);
  const { reset } = useGrindingStore();

  const scrollCornerPattern = `
    M 0 10 Q 10 0, 20 10 T 40 10
    M 5 15 Q 15 5, 25 15 T 45 15
  `;

  const stones: Array<{ grit: GritType; label: string; x: number; y: number }> = [
    { grit: 120, label: '粗磨 120目', x: 30, y: 150 },
    { grit: 400, label: '中磨 400目', x: 30, y: 210 },
    { grit: 1200, label: '精磨 1200目', x: 30, y: 270 },
  ];

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4 overflow-hidden"
      style={{
        background: `
          linear-gradient(135deg, rgba(245,230,211,0.95) 0%, rgba(232,216,184,0.9) 100%),
          url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.08'/%3E%3C/svg%3E")
        `,
        fontFamily: '"KaiTi", "STKaiti", "SimSun", serif',
      }}
    >
      <div
        className="relative w-full max-w-5xl rounded-2xl overflow-hidden shadow-2xl"
        style={{
          aspectRatio: '16/10',
          minHeight: 500,
          border: '8px solid #8b4513',
          boxShadow: '0 0 0 3px #6b3410, 0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <svg className="absolute top-0 left-0 w-16 h-16 z-30 pointer-events-none" viewBox="0 0 50 50">
          <path
            d={scrollCornerPattern}
            stroke="#8b4513"
            strokeWidth="1.5"
            fill="none"
            opacity="0.6"
          />
        </svg>
        <svg className="absolute top-0 right-0 w-16 h-16 z-30 pointer-events-none transform rotate-90" viewBox="0 0 50 50">
          <path
            d={scrollCornerPattern}
            stroke="#8b4513"
            strokeWidth="1.5"
            fill="none"
            opacity="0.6"
          />
        </svg>
        <svg className="absolute bottom-0 left-0 w-16 h-16 z-30 pointer-events-none transform -rotate-90" viewBox="0 0 50 50">
          <path
            d={scrollCornerPattern}
            stroke="#8b4513"
            strokeWidth="1.5"
            fill="none"
            opacity="0.6"
          />
        </svg>
        <svg className="absolute bottom-0 right-0 w-16 h-16 z-30 pointer-events-none transform rotate-180" viewBox="0 0 50 50">
          <path
            d={scrollCornerPattern}
            stroke="#8b4513"
            strokeWidth="1.5"
            fill="none"
            opacity="0.6"
          />
        </svg>

        <div className="absolute inset-0 flex">
          <div className="w-64 hidden lg:block p-4 z-20">
            <ProgressPanel />
            <motion.button
              className="mt-4 w-full py-2 px-4 rounded-lg font-medium text-sm"
              style={{
                background: 'linear-gradient(145deg, #8b4513, #6b3410)',
                color: '#f5e6d3',
                boxShadow: '0 4px 12px rgba(139,69,19,0.4)',
              }}
              whileHover={{ scale: 1.02, boxShadow: '0 6px 16px rgba(139,69,19,0.5)' }}
              whileTap={{ scale: 0.98 }}
              onClick={reset}
            >
              重新开始
            </motion.button>
          </div>

          <div className="flex-1 relative">
            <div
              className="absolute inset-0"
              style={{
                background: `
                  linear-gradient(to bottom, 
                    #6b4e3a 0%, 
                    #5a4230 40%, 
                    #7a8a7a 40%, 
                    #6a7a6a 100%
                  )
                `,
              }}
            />

            <div
              className="absolute left-0 top-0 bottom-0 w-1/3"
              style={{
                background: `
                  linear-gradient(to right, 
                    rgba(122,138,122,0.3) 0%, 
                    transparent 100%
                  )
                `,
              }}
            />

            <div
              className="absolute inset-0 opacity-30"
              style={{
                backgroundImage: `
                  repeating-linear-gradient(
                    90deg,
                    transparent,
                    transparent 60px,
                    rgba(74,46,27,0.1) 60px,
                    rgba(74,46,27,0.1) 62px
                  ),
                  repeating-linear-gradient(
                    0deg,
                    transparent,
                    transparent 40px,
                    rgba(74,46,27,0.08) 40px,
                    rgba(74,46,27,0.08) 42px
                  )
                `,
              }}
            />

            <div
              className="absolute left-4 top-16 bottom-24 w-16 rounded-lg"
              style={{
                background: `
                  linear-gradient(145deg, 
                    rgba(122,138,122,0.9) 0%, 
                    rgba(90,106,90,0.95) 100%
                  )
                `,
                boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.3), 4px 4px 15px rgba(0,0,0,0.4)',
                border: '2px solid #5a6a5a',
              }}
            >
              <div className="absolute top-4 left-0 right-0 text-center">
                <span className="text-amber-100 text-xs font-medium writing-vertical">磨石架</span>
              </div>
            </div>

            <div
              className="absolute"
              style={{
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div
                className="relative"
                style={{
                  width: 180,
                  height: 100,
                }}
              >
                <div
                  className="absolute top-0 left-1/2 transform -translate-x-1/2 rounded-full"
                  style={{
                    width: 180,
                    height: 35,
                    background: `
                      radial-gradient(ellipse at 30% 30%, 
                        #e8e8e8 0%, 
                        #d4d4d4 40%, 
                        #b0b0b0 100%
                      )
                    `,
                    boxShadow: `
                      inset 0 2px 10px rgba(255,255,255,0.5),
                      inset 0 -2px 10px rgba(0,0,0,0.2),
                      0 8px 20px rgba(0,0,0,0.4)
                    `,
                  }}
                />
                <div
                  className="absolute top-8 left-1/2 transform -translate-x-1/2"
                  style={{
                    width: 140,
                    height: 70,
                    background: `
                      linear-gradient(to bottom,
                        #9a9a8a 0%,
                        #7a7a6a 30%,
                        #5a5a4a 100%
                      )
                    `,
                    clipPath: 'polygon(10% 0%, 90% 0%, 100% 100%, 0% 100%)',
                    boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.3)',
                  }}
                />
                <div
                  className="absolute bottom-0 left-1/2 transform -translate-x-1/2 rounded-b-2xl"
                  style={{
                    width: 160,
                    height: 20,
                    background: `
                      linear-gradient(to bottom,
                        #6a6a5a 0%,
                        #4a4a3a 100%
                      )
                    `,
                    boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
                  }}
                />
              </div>

              <div
                ref={mirrorRef}
                className="absolute"
                style={{
                  left: '50%',
                  top: -20,
                  transform: 'translate(-50%, -100%)',
                }}
              >
                <Mirror />
              </div>
            </div>

            <div className="absolute inset-0 pointer-events-none">
              {stones.map((stone) => (
                <div key={stone.grit} className="pointer-events-auto">
                  <GrindingStone
                    grit={stone.grit}
                    label={stone.label}
                    initialX={stone.x}
                    initialY={stone.y}
                    mirrorRef={mirrorRef}
                  />
                </div>
              ))}
            </div>

            <div className="absolute inset-0 pointer-events-none">
              <div className="pointer-events-auto">
                <DeerSkin
                  mirrorRef={mirrorRef}
                  initialX={520}
                  initialY={250}
                />
              </div>
            </div>

            <OilLamp />

            <div
              className="absolute text-center pointer-events-none"
              style={{
                top: 20,
                left: '50%',
                transform: 'translateX(-50%)',
              }}
            >
              <motion.h1
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                className="text-2xl font-bold"
                style={{
                  color: '#4a2e1b',
                  textShadow: '2px 2px 4px rgba(255,248,220,0.8)',
                  fontFamily: '"KaiTi", "STKaiti", serif',
                }}
              >
                唐代磨镜工坊
              </motion.h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.5 }}
                className="text-xs text-amber-800 mt-1"
              >
                拖拽磨石至镜面，按住鼠标环形研磨
              </motion.p>
            </div>

            <div className="lg:hidden absolute top-4 right-4 z-30">
              <button className="w-10 h-10 rounded-lg bg-amber-800 text-amber-100 flex items-center justify-center text-lg">
                ☰
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
