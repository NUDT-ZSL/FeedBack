import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { usePlants } from './hooks/usePlants';
import HomePage from './components/HomePage';
import DetailPage from './components/DetailPage';
import ReminderPage from './components/ReminderPage';

const App: React.FC = () => {
  const {
    plants,
    loading,
    addPlant,
    fetchPlantById,
    fetchRecords,
    addRecord,
    fetchTodayReminders,
  } = usePlants();

  return (
    <Routes>
      <Route
        path="/"
        element={
          <HomePage
            plants={plants}
            loading={loading}
            addPlant={addPlant}
            fetchTodayReminders={fetchTodayReminders}
          />
        }
      />
      <Route
        path="/plant/:id"
        element={
          <DetailPage
            fetchPlantById={fetchPlantById}
            fetchRecords={fetchRecords}
            addRecord={addRecord}
          />
        }
      />
      <Route
        path="/reminders"
        element={
          <ReminderPage
            fetchTodayReminders={fetchTodayReminders}
          />
        }
      />
    </Routes>
  );
};

export default App;
