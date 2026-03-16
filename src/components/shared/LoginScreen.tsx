/* ===================================================================
   LoginScreen -- Google Sign-In with Alter5 branding
   =================================================================== */

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { colors, font, layout, spacing, shadows, transitions } from '../../theme/tokens';
import { getGoogleClientId, verifyToken } from '../../utils/auth';
import type { AuthUser } from '../../utils/auth';

// -- Types --------------------------------------------------------

interface LoginScreenProps {
  onLogin: (user: AuthUser) => void;
}

// -- Google GIS type declarations ---------------------------------

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          renderButton: (el: HTMLElement, config: any) => void;
          prompt: () => void;
        };
      };
    };
  }
}

// -- Component ----------------------------------------------------

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [gisReady, setGisReady] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);

  // Load Google Identity Services script
  useEffect(() => {
    const clientId = getGoogleClientId();
    if (!clientId) {
      setError('VITE_GOOGLE_CLIENT_ID no configurado. Contacta al administrador.');
      return;
    }

    // Check if already loaded
    if (window.google?.accounts?.id) {
      initializeGIS(clientId);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => initializeGIS(clientId);
    script.onerror = () => setError('Error cargando Google Sign-In. Recarga la pagina.');
    document.head.appendChild(script);

    return () => {
      // Cleanup only if we added it
      if (script.parentNode) script.parentNode.removeChild(script);
    };
  }, []);

  function initializeGIS(clientId: string) {
    if (!window.google?.accounts?.id) return;

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    // Render the Google button
    if (buttonRef.current) {
      window.google.accounts.id.renderButton(buttonRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        width: 340,
        text: 'signin_with',
        shape: 'rectangular',
        logo_alignment: 'left',
      });
    }

    setGisReady(true);
  }

  async function handleCredentialResponse(response: { credential: string }) {
    setError('');
    setLoading(true);

    try {
      const verified = await verifyToken(response.credential);
      if (verified) {
        onLogin(verified);
      } else {
        setError('No se pudo verificar tu cuenta. Asegurate de usar tu email @alter-5.com.');
      }
    } catch (err: any) {
      setError(`Error: ${err.message || 'Intenta de nuevo.'}`);
    } finally {
      setLoading(false);
    }
  }

  // -- Styles -------------------------------------------------------

  const wrapperStyle: React.CSSProperties = {
    display: 'flex',
    minHeight: '100vh',
    fontFamily: font.family,
  };

  const leftStyle: React.CSSProperties = {
    flex: 1,
    background: colors.dark.bg,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    padding: spacing['3xl'],
    minHeight: 400,
  };

  const rightStyle: React.CSSProperties = {
    flex: 1,
    background: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['3xl'],
    minHeight: 400,
  };

  // Decorative circles
  const circleBase: React.CSSProperties = {
    position: 'absolute',
    borderRadius: '50%',
    filter: 'blur(80px)',
    opacity: 0.3,
  };

  const circle1: React.CSSProperties = {
    ...circleBase,
    width: 300,
    height: 300,
    background: colors.accent.blue,
    top: -80,
    right: -60,
  };

  const circle2: React.CSSProperties = {
    ...circleBase,
    width: 250,
    height: 250,
    background: colors.accent.green,
    bottom: -60,
    left: -40,
  };

  const circle3: React.CSSProperties = {
    ...circleBase,
    width: 200,
    height: 200,
    background: colors.accent.purple,
    top: '40%',
    left: '15%',
    opacity: 0.15,
  };

  const logoStyle: React.CSSProperties = {
    fontSize: font.size['3xl'],
    fontWeight: font.weight.bold,
    color: colors.text.onDark,
    marginBottom: spacing.md,
    zIndex: 1,
    letterSpacing: '-0.02em',
  };

  const brandSubStyle: React.CSSProperties = {
    fontSize: font.size.lg,
    color: colors.accent.blue,
    fontWeight: font.weight.medium,
    zIndex: 1,
    marginBottom: spacing.xl,
  };

  const taglineStyle: React.CSSProperties = {
    fontSize: font.size.md,
    color: colors.text.onDarkSecondary,
    zIndex: 1,
    textAlign: 'center' as const,
    maxWidth: 320,
    lineHeight: font.lineHeight.relaxed,
  };

  const formContainerStyle: React.CSSProperties = {
    maxWidth: 380,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  };

  const formTitleStyle: React.CSSProperties = {
    fontSize: font.size['2xl'],
    fontWeight: font.weight.bold,
    color: colors.text.primary,
    marginBottom: spacing.xs,
    textAlign: 'center' as const,
  };

  const formSubtitleStyle: React.CSSProperties = {
    fontSize: font.size.md,
    color: colors.text.secondary,
    marginBottom: spacing['3xl'],
    textAlign: 'center' as const,
  };

  const errorStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    borderRadius: layout.borderRadius.md,
    padding: `${spacing.md} ${spacing.lg}`,
    fontSize: font.size.sm,
    color: '#DC2626',
    marginTop: spacing.xl,
    maxWidth: 340,
    lineHeight: font.lineHeight.normal,
  };

  const loadingStyle: React.CSSProperties = {
    fontSize: font.size.md,
    color: colors.text.secondary,
    marginTop: spacing.xl,
  };

  const domainHintStyle: React.CSSProperties = {
    fontSize: font.size.xs,
    color: colors.text.muted,
    marginTop: spacing.lg,
    textAlign: 'center' as const,
  };

  return (
    <motion.div
      style={wrapperStyle}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      {/* Left -- Branding */}
      <div style={leftStyle}>
        <div style={circle1} />
        <div style={circle2} />
        <div style={circle3} />

        <motion.div
          style={logoStyle}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          Alter5
        </motion.div>

        <motion.div
          style={brandSubStyle}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.5 }}
        >
          Business Intelligence
        </motion.div>

        <motion.div
          style={taglineStyle}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
        >
          Plataforma de inteligencia comercial para financiacion de energias renovables
        </motion.div>
      </div>

      {/* Right -- Google Sign-In */}
      <div style={rightStyle}>
        <motion.div
          style={formContainerStyle}
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          <div style={formTitleStyle}>Iniciar sesion</div>
          <div style={formSubtitleStyle}>Accede con tu cuenta de Google Workspace</div>

          {/* Google Sign-In button container */}
          <div
            ref={buttonRef}
            style={{
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          />

          {!gisReady && !error && (
            <div style={loadingStyle}>Cargando...</div>
          )}

          {loading && (
            <div style={loadingStyle}>Verificando cuenta...</div>
          )}

          {error && (
            <div style={errorStyle}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <div style={domainHintStyle}>
            Solo cuentas @alter-5.com
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
