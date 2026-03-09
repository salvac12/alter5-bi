/* ═══════════════════════════════════════════════════════════════
   SettingsPanel — Slide-in settings / profile panel
   ═══════════════════════════════════════════════════════════════ */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Bell, BellOff, Moon, Sun, Users } from 'lucide-react';
import { colors, font, layout, spacing, shadows, transitions, darkPanel } from '../../theme/tokens';
import { TEAM_MEMBERS } from '../../utils/airtableProspects';

// ── Types ───────────────────────────────────────────────────────

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: string;
  onUserChange: (name: string) => void;
}

// ── Component ───────────────────────────────────────────────────

export function SettingsPanel({ isOpen, onClose, currentUser, onUserChange }: SettingsPanelProps) {
  const [darkMode, setDarkMode] = useState(false);
  const [notifications, setNotifications] = useState(true);

  const currentMember = TEAM_MEMBERS.find(m => m.name === currentUser);
  const initials = currentUser
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  // ── Styles ──────────────────────────────────────────────────

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 8000,
  };

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: 400,
    maxWidth: '100vw',
    background: colors.dark.bg,
    borderLeft: `1px solid ${colors.dark.border}`,
    boxShadow: shadows.panel,
    zIndex: 8001,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.xl} ${spacing['2xl']}`,
    borderBottom: `1px solid ${colors.dark.border}`,
    flexShrink: 0,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: font.size.xl,
    fontWeight: font.weight.semibold,
    color: colors.text.onDark,
    fontFamily: font.family,
  };

  const closeBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: colors.text.onDarkSecondary,
    padding: spacing.xs,
    borderRadius: layout.borderRadius.sm,
    display: 'flex',
    alignItems: 'center',
  };

  const bodyStyle: React.CSSProperties = {
    padding: spacing['2xl'],
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['3xl'],
    flex: 1,
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
    color: colors.text.onDarkSecondary,
    fontFamily: font.family,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: spacing.lg,
  };

  const avatarStyle: React.CSSProperties = {
    width: 64,
    height: 64,
    borderRadius: layout.borderRadius.full,
    background: `linear-gradient(135deg, ${colors.accent.blue}, ${colors.accent.purple})`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: font.size['2xl'],
    fontWeight: font.weight.bold,
    fontFamily: font.family,
    flexShrink: 0,
  };

  const profileRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.lg,
  };

  const profileNameStyle: React.CSSProperties = {
    fontSize: font.size.lg,
    fontWeight: font.weight.semibold,
    color: colors.text.onDark,
    fontFamily: font.family,
  };

  const profileEmailStyle: React.CSSProperties = {
    fontSize: font.size.sm,
    color: colors.text.onDarkSecondary,
    fontFamily: font.family,
    marginTop: 2,
  };

  const toggleRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.md} ${spacing.lg}`,
    background: colors.dark.card,
    borderRadius: layout.borderRadius.md,
    border: `1px solid ${colors.dark.border}`,
  };

  const toggleLabelStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    color: colors.text.onDark,
    fontSize: font.size.md,
    fontFamily: font.family,
  };

  const toggleTrackStyle = (active: boolean): React.CSSProperties => ({
    width: 42,
    height: 24,
    borderRadius: 12,
    background: active ? colors.accent.blue : colors.dark.surface,
    border: `1px solid ${active ? colors.accent.blue : colors.dark.border}`,
    padding: 2,
    cursor: 'pointer',
    transition: transitions.fast,
    display: 'flex',
    alignItems: active ? 'center' : 'center',
    justifyContent: active ? 'flex-end' : 'flex-start',
  });

  const toggleKnobStyle: React.CSSProperties = {
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: '#fff',
    boxShadow: shadows.sm,
  };

  const memberRowStyle = (isActive: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    padding: `${spacing.sm} ${spacing.md}`,
    borderRadius: layout.borderRadius.md,
    background: isActive ? `${colors.accent.blue}15` : 'transparent',
    border: isActive ? `1px solid ${colors.accent.blue}40` : `1px solid transparent`,
    cursor: 'pointer',
    transition: transitions.fast,
  });

  const memberAvatarStyle = (isActive: boolean): React.CSSProperties => ({
    width: 32,
    height: 32,
    borderRadius: layout.borderRadius.full,
    background: isActive
      ? `linear-gradient(135deg, ${colors.accent.blue}, ${colors.accent.purple})`
      : colors.dark.surface,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: isActive ? '#fff' : colors.text.onDarkSecondary,
    fontSize: font.size.xs,
    fontWeight: font.weight.semibold,
    fontFamily: font.family,
    flexShrink: 0,
  });

  const memberNameStyle = (isActive: boolean): React.CSSProperties => ({
    fontSize: font.size.md,
    fontWeight: isActive ? font.weight.semibold : font.weight.normal,
    color: isActive ? colors.text.onDark : colors.text.onDarkSecondary,
    fontFamily: font.family,
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            style={overlayStyle}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            style={panelStyle}
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            exit={{ x: 400 }}
            transition={transitions.spring}
          >
            {/* Header */}
            <div style={headerStyle}>
              <span style={titleStyle}>Configuracion</span>
              <button style={closeBtnStyle} onClick={onClose} aria-label="Cerrar">
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div style={bodyStyle}>
              {/* Profile */}
              <div>
                <div style={sectionTitleStyle}>Perfil</div>
                <div style={profileRowStyle}>
                  <div style={avatarStyle}>{initials}</div>
                  <div>
                    <div style={profileNameStyle}>{currentUser}</div>
                    <div style={profileEmailStyle}>
                      {currentMember?.email || 'usuario@alter-5.com'}
                    </div>
                    <div style={{ ...profileEmailStyle, color: colors.accent.blue, marginTop: 4, fontSize: font.size.xs }}>
                      Deal Manager
                    </div>
                  </div>
                </div>
              </div>

              {/* Preferences */}
              <div>
                <div style={sectionTitleStyle}>Preferencias</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
                  <div style={toggleRowStyle}>
                    <div style={toggleLabelStyle}>
                      {darkMode ? <Moon size={16} /> : <Sun size={16} />}
                      Modo oscuro
                    </div>
                    <div style={toggleTrackStyle(darkMode)} onClick={() => setDarkMode(!darkMode)}>
                      <div style={toggleKnobStyle} />
                    </div>
                  </div>
                  <div style={toggleRowStyle}>
                    <div style={toggleLabelStyle}>
                      {notifications ? <Bell size={16} /> : <BellOff size={16} />}
                      Notificaciones
                    </div>
                    <div style={toggleTrackStyle(notifications)} onClick={() => setNotifications(!notifications)}>
                      <div style={toggleKnobStyle} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Team */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, ...sectionTitleStyle }}>
                  <Users size={14} />
                  Equipo
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
                  {TEAM_MEMBERS.map(member => {
                    const isActive = member.name === currentUser;
                    const memberInitials = member.name
                      .split(' ')
                      .map(w => w[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase();
                    return (
                      <div
                        key={member.email}
                        style={memberRowStyle(isActive)}
                        onClick={() => onUserChange(member.name)}
                      >
                        <div style={memberAvatarStyle(isActive)}>{memberInitials}</div>
                        <div>
                          <div style={memberNameStyle(isActive)}>{member.name}</div>
                          <div style={{ fontSize: font.size.xs, color: colors.text.onDarkMuted, fontFamily: font.family }}>
                            {member.email}
                          </div>
                        </div>
                        {isActive && (
                          <div style={{
                            marginLeft: 'auto',
                            fontSize: font.size.xs,
                            color: colors.accent.blue,
                            fontWeight: font.weight.medium,
                            fontFamily: font.family,
                          }}>
                            Activo
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
