import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './admin-design-tokens.css'
import './styles.css'
import './admin-phase1.css'
import './admin-phase2.css'
import './admin-paper.css'
import './admin-analytics.css'
import './admin-rules.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
