import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { LangProvider } from './context/LangContext.jsx'
import { AlertProvider } from './context/AlertContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { initMonitoring } from './lib/monitoring'
import './index.css'

initMonitoring()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <LangProvider>
          <AlertProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </AlertProvider>
        </LangProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
