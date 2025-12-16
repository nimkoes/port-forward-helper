import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '../App'

// electronAPI 로드 확인
console.log('[Renderer] Starting renderer process...')
console.log('[Renderer] window.electronAPI:', window.electronAPI)

// root 요소 확인
const rootElement = document.getElementById('root')
if (!rootElement) {
  console.error('[Renderer] Root element not found!')
} else {
  console.log('[Renderer] Root element found, rendering App...')
  try {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
    console.log('[Renderer] App rendered successfully')
  } catch (error) {
    console.error('[Renderer] Error rendering App:', error)
  }
}

