import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import App from './App'
import { ToastProvider } from './components/Toast'
import { ThemeProvider } from './components/ThemeProvider'
import './index.css'

const Router = window.exampower ? HashRouter : BrowserRouter

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <Router>
          <App />
        </Router>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>
)
