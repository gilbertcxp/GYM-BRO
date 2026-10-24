import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import { App } from './App'
import { applyTheme, getTheme } from './lib/theme'
import './index.css'

applyTheme(getTheme())

// Tras un despliegue nuevo, una pestaña abierta puede pedir archivos de la versión anterior
// que ya no existen. Se recarga una vez para obtener la versión actual.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'gymbro.reloadedAt'
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0)
    if (Date.now() - last < 10_000) return
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch { /* sin sessionStorage: recargar igual */ }
  event.preventDefault()
  window.location.reload()
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster theme="dark" position="top-center" richColors closeButton />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
