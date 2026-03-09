/* ═══════════════════════════════════════════════════════════════
   LoginScreen — Visual login screen (UI only, no real auth)
   ═══════════════════════════════════════════════════════════════ */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { LogIn, Eye, EyeOff } from 'lucide-react';
import { colors, font, layout, spacing, shadows, transitions } from '../../theme/tokens';

// ── Types ───────────────────────────────────────────────────────

interface LoginScreenProps {
  onLogin: (email: string) => void;
}

// ── Component ───────────────────────────────────────────────────

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin(email);
  };

  // ── Styles ──────────────────────────────────────────────────

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
  };

  const formTitleStyle: React.CSSProperties = {
    fontSize: font.size['2xl'],
    fontWeight: font.weight.bold,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  };

  const formSubtitleStyle: React.CSSProperties = {
    fontSize: font.size.md,
    color: colors.text.secondary,
    marginBottom: spacing['3xl'],
  };

  const fieldGroupStyle: React.CSSProperties = {
    marginBottom: spacing.xl,
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: font.size.sm,
    fontWeight: font.weight.medium,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: `${spacing.md} ${spacing.lg}`,
    borderRadius: layout.borderRadius.md,
    border: `1px solid ${colors.light.border}`,
    fontSize: font.size.md,
    fontFamily: font.family,
    color: colors.text.primary,
    outline: 'none',
    transition: transitions.fast,
    boxSizing: 'border-box' as const,
  };

  const passwordWrapStyle: React.CSSProperties = {
    position: 'relative',
  };

  const eyeBtnStyle: React.CSSProperties = {
    position: 'absolute',
    right: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: colors.text.secondary,
    padding: spacing.xs,
    display: 'flex',
    alignItems: 'center',
  };

  const checkRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing['2xl'],
    cursor: 'pointer',
  };

  const checkboxStyle: React.CSSProperties = {
    width: 18,
    height: 18,
    borderRadius: 4,
    border: `1.5px solid ${remember ? colors.accent.blue : colors.light.border}`,
    background: remember ? colors.accent.blue : 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: transitions.fast,
  };

  const checkLabelStyle: React.CSSProperties = {
    fontSize: font.size.sm,
    color: colors.text.secondary,
  };

  const submitBtnStyle: React.CSSProperties = {
    width: '100%',
    padding: `${spacing.md} ${spacing.xl}`,
    borderRadius: layout.borderRadius.md,
    border: 'none',
    background: `linear-gradient(135deg, ${colors.accent.blue}, ${colors.accent.green})`,
    color: '#fff',
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    fontFamily: font.family,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    transition: transitions.fast,
    boxShadow: shadows.md,
  };

  // Responsive: media query via inline fallback (use flex-direction)
  const responsiveStyle: React.CSSProperties = {
    ...wrapperStyle,
  };

  // We detect narrow screen via a CSS-like approach with minWidth on each side
  // The flex: 1 on both sides handles the split naturally

  return (
    <motion.div
      style={responsiveStyle}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      {/* Left — Branding */}
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

      {/* Right — Form */}
      <div style={rightStyle}>
        <motion.div
          style={formContainerStyle}
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          <div style={formTitleStyle}>Iniciar sesion</div>
          <div style={formSubtitleStyle}>Accede a tu panel de inteligencia comercial</div>

          <form onSubmit={handleSubmit}>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="nombre@alter-5.com"
                style={inputStyle}
                onFocus={e => {
                  e.currentTarget.style.borderColor = colors.accent.blue;
                  e.currentTarget.style.boxShadow = `0 0 0 3px ${colors.accent.blue}20`;
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor = colors.light.border;
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>

            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Contrasena</label>
              <div style={passwordWrapStyle}>
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Tu contrasena"
                  style={{ ...inputStyle, paddingRight: 44 }}
                  onFocus={e => {
                    e.currentTarget.style.borderColor = colors.accent.blue;
                    e.currentTarget.style.boxShadow = `0 0 0 3px ${colors.accent.blue}20`;
                  }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor = colors.light.border;
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
                <button
                  type="button"
                  style={eyeBtnStyle}
                  onClick={() => setShowPwd(!showPwd)}
                  aria-label={showPwd ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                >
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div style={checkRowStyle} onClick={() => setRemember(!remember)}>
              <div style={checkboxStyle}>
                {remember && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 6L5 8.5L9.5 3.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <span style={checkLabelStyle}>Recordarme</span>
            </div>

            <button type="submit" style={submitBtnStyle}>
              <LogIn size={16} />
              Entrar
            </button>
          </form>
        </motion.div>
      </div>
    </motion.div>
  );
}
