import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// React应用入口
// 数据流向：将App组件渲染到index.html的root节点
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
