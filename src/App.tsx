import React, { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Work, Comment, Category } from './types';
import { mockWorks } from './data/mockData';
import { StatsPanel } from './components/StatsPanel';
import { WorkDetail } from './components/WorkDetail';
import { CreateWork } from './components/CreateWork';

const App: React.FC = () => {
  const [works, setWorks] = useState<Work[]>(mockWorks);

  const handleAddComment = (workId: string, comment: Comment) => {
    setWorks(works.map(work =>
      work.id === workId
        ? { ...work, comments: [...work.comments, comment] }
        : work
    ));
  };

  const handleCreateWork = (newWork: {
    name: string;
    category: Category;
    steps: { id: string; order: number; image: string; description: string; duration: number }[];
  }) => {
    const work: Work = {
      id: `work-${Date.now()}`,
      name: newWork.name,
      category: newWork.category,
      coverImage: newWork.steps[0]?.image || '',
      steps: newWork.steps,
      createdAt: new Date().toISOString(),
      favorites: 0,
      comments: [],
    };
    setWorks([work, ...works]);
  };

  return (
    <Routes>
      <Route path="/" element={<StatsPanel works={works} />} />
      <Route
        path="/work/:id"
        element={<WorkDetail works={works} onAddComment={handleAddComment} />}
      />
      <Route
        path="/create"
        element={<CreateWork onCreateWork={handleCreateWork} />}
      />
    </Routes>
  );
};

export default App;
