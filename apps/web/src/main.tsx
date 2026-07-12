import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthGate } from './auth/AuthGate'
import { AuthProvider } from './auth/AuthProvider'
import { PreferencesProvider } from './preferences'
import { WorkspaceGate, WorkspaceProvider } from './workspace'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreferencesProvider>
      <AuthProvider>
        <AuthGate>
          <WorkspaceProvider>
            <WorkspaceGate>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </WorkspaceGate>
          </WorkspaceProvider>
        </AuthGate>
      </AuthProvider>
    </PreferencesProvider>
  </StrictMode>,
)
