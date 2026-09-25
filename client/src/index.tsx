import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './main.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container not found. Please ensure there is a <div id="root"></div> in your HTML.');
}

const root = ReactDOM.createRoot(container);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
