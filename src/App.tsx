import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { StoryList } from './components/StoryList';
import { StoryReader } from './components/StoryReader';
import { Toast } from './components/Toast';

const App: React.FC = () => {
  return (
    <AppProvider>
      <Router>
        <Toast />
        <Routes>
          <Route path="/" element={<StoryList />} />
          <Route path="/story/:id" element={<StoryReader />} />
        </Routes>
      </Router>
    </AppProvider>
  );
};

export default App;
