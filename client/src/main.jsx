import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LangProvider } from './i18n'
import ErrorBoundary from './components/ErrorBoundary'
import App from './App.jsx'

window.addEventListener('error', e => {
  console.error('GLOBAL_ERROR:', e.error?.message || e.message, e.error?.stack || '')
  fetch('/api/analytics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client_error', session_id: '', data: { message: e.error?.message || e.message, stack: e.error?.stack } })
  }).catch(() => {})
})
window.addEventListener('unhandledrejection', e => {
  console.error('UNHANDLED_REJECTION:', e.reason?.message || e.reason, e.reason?.stack || '')
  fetch('/api/analytics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client_error', session_id: '', data: { message: e.reason?.message || String(e.reason), stack: e.reason?.stack } })
  }).catch(() => {})
})

createRoot(document.getElementById('root'), {
  onRecoverableError: (err, errInfo) => {
    console.error('RECOVERABLE_ERROR:', err.message, errInfo.componentStack)
  }
}).render(
  <StrictMode>
    <ErrorBoundary>
      <LangProvider>
        <App />
      </LangProvider>
    </ErrorBoundary>
  </StrictMode>,
)
