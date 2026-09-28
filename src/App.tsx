import { useState, useCallback, useMemo } from 'react';
import { Compass } from 'lucide-react';
import StarField from './StarField';
import FilterPanel from './FilterPanel';
import StarInfoCard from './StarInfoCard';
import { stars as generatedStars } from './StarData';
import { Star, FilterState, SpectralType } from './types';
import './App.css';

const ALL_SPECTRAL_TYPES: SpectralType[] = ['O', 'B', 'A', 'F', 'G', 'K', 'M'];

export default function App() {
  const stars = useMemo(() => generatedStars, []);
  
  const [filter, setFilter] = useState<FilterState>({
    spectralTypes: [...ALL_SPECTRAL_TYPES],
    magnitudeRange: [-1, 10],
  });

  const [selectedStar, setSelectedStar] = useState<Star | null>(null);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  const handleFilterChange = useCallback((newFilter: FilterState) => {
    setFilter(newFilter);
  }, []);

  const handleStarClick = useCallback((star: Star | null) => {
    setSelectedStar(star);
  }, []);

  const handleCloseInfo = useCallback(() => {
    setSelectedStar(null);
  }, []);

  const handleResetView = useCallback(() => {
    setResetTrigger(prev => prev + 1);
  }, []);

  const handleMobileToggle = useCallback(() => {
    setMobilePanelOpen(prev => !prev);
  }, []);

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <button className="mobile-menu-placeholder" aria-hidden="true" />
        </div>
        <h1 className="app-title">银河星图探索</h1>
        <div className="header-right">
          <button 
            className="reset-button"
            onClick={handleResetView}
            title="复位视角"
          >
            <Compass size={20} />
          </button>
        </div>
      </header>

      <div className="app-main">
        <aside className="left-panel">
          <FilterPanel 
            filter={filter}
            onFilterChange={handleFilterChange}
            isMobileOpen={mobilePanelOpen}
            onMobileToggle={handleMobileToggle}
          />
        </aside>

        <main className="canvas-container">
          <StarField
            stars={stars}
            filter={filter}
            selectedStarId={selectedStar?.id ?? null}
            onStarClick={handleStarClick}
            resetTrigger={resetTrigger}
          />
        </main>

        <aside className="right-panel">
          {selectedStar && (
            <StarInfoCard star={selectedStar} onClose={handleCloseInfo} />
          )}
        </aside>
      </div>

      <div className="instructions">
        <p>拖拽旋转 · 滚轮缩放 · 点击恒星查看详情</p>
      </div>
    </div>
  );
}
