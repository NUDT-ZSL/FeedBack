import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: {
            borderRadius: '10px',
            padding: '12px 18px',
            fontSize: '14px',
            fontWeight: 500,
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)'
          },
          success: {
            style: {
              background: '#e8f5e9',
              color: '#2e7d32',
              border: '1px solid #a5d6a7'
            }
          },
          error: {
            style: {
              background: '#ffebee',
              color: '#c62828',
              border: '1px solid #ef9a9a'
            }
          }
        }}
      />
      <App />
    </HashRouter>
  </React.StrictMode>
)
