import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Sidebar from './components/Sidebar'
import PlayerBar from './components/PlayerBar'
import HomePage from './pages/HomePage'
import WorkDetailPage from './pages/WorkDetailPage'
import DashboardPage from './pages/DashboardPage'
import UploadPage from './pages/UploadPage'

function App() {
  return (
    <Router>
      <div className="min-h-screen">
        <Sidebar />
        
        <main className="md:ml-60 p-6 md:p-8 pt-16 md:pt-8 pb-28">
          <div className="max-w-7xl mx-auto">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/work/:id" element={<WorkDetailPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/upload" element={<UploadPage />} />
            </Routes>
          </div>
        </main>

        <PlayerBar />

        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: 'rgba(0, 0, 0, 0.9)',
              color: '#fff',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(10px)',
              borderRadius: '12px',
            },
          }}
        />
      </div>
    </Router>
  )
}

export default App
