import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { LoginScreen } from './components/shared/LoginScreen'
import { ToastProvider } from './components/shared/ToastSystem'
import { getStoredAuth, verifyToken, storeAuth, clearAuth } from './utils/auth'
import type { AuthUser } from './utils/auth'
import './index.css'

function AuthGate() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const stored = getStoredAuth();
    if (stored) {
      // Verify stored token is still valid
      verifyToken(stored.token).then(verified => {
        if (verified) setUser(verified);
        else clearAuth();
        setChecking(false);
      });
    } else {
      setChecking(false);
    }
  }, []);

  const handleLogin = (authedUser: AuthUser) => {
    storeAuth(authedUser);
    setUser(authedUser);
  };

  const handleLogout = () => {
    clearAuth();
    setUser(null);
  };

  if (checking) {
    return (
      <div style={{
        display: 'flex',
        height: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
        color: '#64748B',
        fontSize: 14,
      }}>
        Verificando sesion...
      </div>
    );
  }

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
