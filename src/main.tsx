import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { LoginScreen } from './components/shared/LoginScreen'
import { ToastProvider } from './components/shared/ToastSystem'
import { getStoredAuth, storeAuth, clearAuth } from './utils/auth'
import type { AuthUser } from './utils/auth'
import './index.css'

function AuthGate() {
  // Check localStorage synchronously — no need to re-verify expired Google tokens
  const [user, setUser] = useState<AuthUser | null>(() => getStoredAuth());

  const handleLogin = (authedUser: AuthUser) => {
    storeAuth(authedUser);
    setUser(authedUser);
  };

  const handleLogout = () => {
    clearAuth();
    setUser(null);
  };

  if (!user) return <LoginScreen onLogin={handleLogin} />;

  return <App authUser={user} onLogout={handleLogout} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <AuthGate />
    </ToastProvider>
  </React.StrictMode>,
)
