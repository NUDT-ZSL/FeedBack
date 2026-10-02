import { motion } from 'framer-motion';
import { useStore } from '@/store';
import IngredientRack from '@/components/IngredientRack';
import Mortar from '@/components/Mortar';
import Censer from '@/components/Censer';

function App() {
  const reset = useStore(state => state.reset);
  const isBurning = useStore(state => state.isBurning);

  return (
    <div 
      className="min-h-screen w-full py-6 px-4"
      style={{
        background: `
          linear-gradient(180deg, rgba(58,42,26,0.95) 0%, rgba(42,30,18,0.98) 100%),
          repeating-linear-gradient(
            90deg,
            transparent,
            transparent 50px,
            rgba(0,0,0,0.05) 50px,
            rgba(0,0,0,0.05) 51px
          ),
          repeating-linear-gradient(
            0deg,
            transparent,
            transparent 50px,
            rgba(0,0,0,0.05) 50px,
            rgba(0,0,0,0.05) 51px
          )
        `,
        filter: isBurning ? 'brightness(1.05)' : 'none',
        transition: 'filter 0.5s ease',
      }}
    >
      <div className="max-w-7xl mx-auto">
        <motion.header
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-8"
        >
          <h1 
            className="text-4xl md:text-5xl font-bold mb-2"
            style={{
              color: '#d4a017',
              textShadow: '2px 2px 4px rgba(0,0,0,0.5), 0 0 20px rgba(212,160,23,0.3)',
              letterSpacing: '0.1em',
            }}
          >
            西市调香坊
          </h1>
          <p 
            className="text-sm md:text-base"
            style={{ color: 'rgba(245,245,220,0.7)' }}
          >
            大唐长安 · 西域香料 · 匠心调香
          </p>
        </motion.header>

        <div 
          className="p-4 md:p-6 rounded-xl"
          style={{
            background: 'linear-gradient(135deg, rgba(107,78,58,0.3) 0%, rgba(90,63,46,0.3) 100%)',
            border: '3px solid #d4a017',
            boxShadow: '0 0 30px rgba(212,160,23,0.2), inset 0 0 60px rgba(0,0,0,0.3)',
          }}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 items-start">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="flex justify-center"
            >
              <IngredientRack />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="flex justify-center"
            >
              <Mortar />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.6 }}
              className="flex justify-center"
            >
              <Censer />
            </motion.div>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="flex justify-center mt-6"
        >
          <motion.button
            onClick={reset}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="px-6 py-2 rounded-lg font-bold"
            style={{
              background: 'linear-gradient(135deg, rgba(139,94,58,0.8) 0%, rgba(90,63,46,0.8) 100%)',
              color: '#d4a017',
              border: '2px solid #d4a017',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
          >
            重新开始
          </motion.button>
        </motion.div>

        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 1 }}
          className="text-center mt-8 text-xs"
          style={{ color: 'rgba(245,245,220,0.4)' }}
        >
          <p>使用说明：点击或拖动香料添加到配方槽 → 在乳钵中拖动碾槌研磨 → 点击合香 → 将合香拖到香炉 → 点击点燃</p>
        </motion.footer>
      </div>
    </div>
  );
}

export default App;
