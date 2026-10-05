import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('CallPilot root element is missing.')
}

const root = createRoot(rootElement)

function renderStartupError(error: unknown) {
  console.error('CallPilot startup failed:', error)

  const message = error instanceof Error ? error.message : String(error)
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''

  const detail = code || message

  root.render(
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        background: '#07070b',
        color: '#f7f7fb',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <section
        style={{
          width: 'min(100%, 520px)',
          padding: '28px',
          border: '1px solid rgba(255,255,255,.1)',
          borderRadius: '24px',
          background: '#15151d',
          boxShadow: '0 28px 80px rgba(0,0,0,.45)',
        }}
      >
        <div style={{ color: '#817cff', fontSize: '11px', fontWeight: 800, letterSpacing: '2px' }}>
          VATTAMS CALLPILOT
        </div>
        <h1 style={{ margin: '12px 0 8px', fontSize: '28px' }}>Startup configuration error</h1>
        <p style={{ margin: 0, color: '#9b9ba5', lineHeight: 1.6 }}>
          CallPilot could not start. Please refresh the page. If the problem continues, the
          production configuration needs attention.
        </p>
        <code
          style={{
            display: 'block',
            marginTop: '18px',
            padding: '12px',
            overflowWrap: 'anywhere',
            borderRadius: '12px',
            background: '#0d0d13',
            color: '#c7c3ff',
            fontSize: '12px',
          }}
        >
          {detail}
        </code>
      </section>
    </main>,
  )
}

import('./App.tsx')
  .then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
  .catch(renderStartupError)
