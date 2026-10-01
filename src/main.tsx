import React from 'react'
import ReactDOM from 'react-dom/client'
import PrintWorkshop from './PrintWorkshop'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div className="app-container">
      <PrintWorkshop />
    </div>
  </React.StrictMode>,
)
