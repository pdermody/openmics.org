import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { queryClient } from './api/queryClient'
import { initAuth } from './auth/session'
import { i18nReady } from './i18n'
import { installLinkInterceptor } from './navigation'

installLinkInterceptor()

void i18nReady.then(() => initAuth({
  onSignedIn: () => {
    queryClient.invalidateQueries({ queryKey: ['auth', 'session'] })
    queryClient.invalidateQueries()
  },
  onSignedOut: () => {
    queryClient.clear()
    queryClient.invalidateQueries({ queryKey: ['auth', 'session'] })
  },
}))

void i18nReady.then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
))
