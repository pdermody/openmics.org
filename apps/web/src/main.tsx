import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { queryClient } from './api/queryClient'
import { initAuth } from './auth/session'
import { i18nReady } from './i18n'

void i18nReady.then(() => initAuth({
  onSignedIn: () => queryClient.invalidateQueries(),
  onSignedOut: () => queryClient.clear(),
}))

void i18nReady.then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
))
