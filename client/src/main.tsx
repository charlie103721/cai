import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/api'
import { AuthProvider } from './contexts/AuthContext'
import { Toaster } from 'sonner'
import { initTheme } from './hooks/useTheme'
import App from './App'
import './index.css'

// Apply stored theme before first render to prevent flash
initTheme()

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found in DOM')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
          <Toaster />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
