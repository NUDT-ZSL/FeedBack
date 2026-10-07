import React, { useState, useCallback } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import HomePage from './components/HomePage';
import FillingSelection from './components/FillingSelection';
import MoldDesign from './components/MoldDesign';
import OrderConfirm from './components/OrderConfirm';
import GreetingCard from './components/GreetingCard';
import { Filling, Mold, OrderData } from './types';

const App: React.FC = () => {
  const [orderData, setOrderData] = useState<OrderData>({
    fillings: [],
    mold: null,
    drawingData: '',
    baked: false,
    recipientName: '',
    blessing: '',
  });

  const navigate = useNavigate();

  const updateFillings = useCallback((fillings: Filling[]) => {
    setOrderData(prev => ({ ...prev, fillings }));
  }, []);

  const updateMold = useCallback((mold: Mold) => {
    setOrderData(prev => ({ ...prev, mold }));
  }, []);

  const updateDrawing = useCallback((drawingData: string, baked: boolean) => {
    setOrderData(prev => ({ ...prev, drawingData, baked }));
  }, []);

  const updateRecipient = useCallback((name: string, blessing: string) => {
    setOrderData(prev => ({ ...prev, recipientName: name, blessing }));
  }, []);

  const goToFillings = useCallback(() => navigate('/fillings'), [navigate]);
  const goToDesign = useCallback(() => navigate('/design'), [navigate]);
  const goToConfirm = useCallback(() => navigate('/confirm'), [navigate]);
  const goToCard = useCallback((orderId: string) => navigate(`/card/${orderId}`), [navigate]);
  const goHome = useCallback(() => navigate('/'), [navigate]);

  return (
    <div className="app-container page-transition">
      <Routes>
        <Route path="/" element={<HomePage onEnter={goToFillings} />} />
        <Route
          path="/fillings"
          element={
            <FillingSelection
              selectedFillings={orderData.fillings}
              onSelectFillings={updateFillings}
              onNext={goToDesign}
              onBack={goHome}
            />
          }
        />
        <Route
          path="/design"
          element={
            <MoldDesign
              selectedMold={orderData.mold}
              drawingData={orderData.drawingData}
              baked={orderData.baked}
              onSelectMold={updateMold}
              onDrawingComplete={updateDrawing}
              onNext={goToConfirm}
              onBack={goToFillings}
            />
          }
        />
        <Route
          path="/confirm"
          element={
            <OrderConfirm
              orderData={orderData}
              onUpdateRecipient={updateRecipient}
              onOrderComplete={goToCard}
              onBack={goToDesign}
            />
          }
        />
        <Route path="/card/:orderId" element={<GreetingCard onBack={goHome} />} />
      </Routes>
    </div>
  );
};

export default App;
