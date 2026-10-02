import React from 'react';
import PitchArea from './components/PitchArea';
import ScoreBoard from './components/ScoreBoard';
import NPCGuests from './components/NPCGuests';

const App: React.FC = () => {
  return (
    <div className="game-container">
      <div className="game-main">
        <div style={{ flex: 1, position: 'relative' }}>
          <PitchArea />
          <NPCGuests />
        </div>
        <ScoreBoard />
      </div>
    </div>
  );
};

export default App;
