import { useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Brain, Download, Settings, Trash2 } from 'lucide-react';
import alter5Logo from '../../assets/alter5-logo.svg';
import { colors, font, layout, shadows, spacing, transitions } from '../../theme/tokens';
import type { ViewId } from '../../types';

interface HeaderProps {
  activeView: ViewId;
  search: string;
  onSearchChange: (val: string) => void;
  onOpenCerebro: () => void;
  onExportCSV: () => void;
  filteredCount: number;
  cleanupMode: boolean;
  onToggleCleanup: () => void;
  currentUser: any;
  onOpenSettings: () => void;
  subtitle: string;
}

export default function Header({
  activeView,
  search,
  onSearchChange,
  onOpenCerebro,
  onExportCSV,
  filteredCount,
  cleanupMode,
  onToggleCleanup,
  currentUser,
  onOpenSettings,
  subtitle,
}: HeaderProps) {
  const [searchFocused, setSearchFocused] = useState(false);

  return (
    <header style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: layout.headerHeight,
      background: colors.headerBg,
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderBottom: `1px solid rgba(255,255,255,0.08)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: `0 ${spacing.xl}`,
      zIndex: 100,
    }}>
      {/* Left: Logo + Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
        <img src={alter5Logo} alt="Alter5" style={{ height: 28, filter: 'brightness(0) invert(1)' }} />
        <div>
          <h1 style={{
            fontSize: font.size.lg,
            fontWeight: font.weight.bold,
            color: '#FFFFFF',
            margin: 0,
            letterSpacing: '-0.5px',
            lineHeight: 1.2,
          }}>
            Business Intelligence
          </h1>
          <p style={{
            fontSize: font.size.xs,
            color: colors.text.onDarkSecondary,
            margin: 0,
          }}>{subtitle}</p>
        </div>
      </div>

      {/* Center: Search (only in empresas) */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', maxWidth: 480, margin: '0 auto' }}>
        {activeView === 'empresas' && (
          <div style={{
            position: 'relative',
            width: '100%',
            maxWidth: 360,
          }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: searchFocused ? colors.accent.blue : colors.text.onDarkMuted,
                transition: transitions.fast,
              }}
            />
            <input
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="Buscar empresa, rol, tipo..."
              style={{
                width: '100%',
                padding: '8px 14px 8px 36px',
                borderRadius: layout.borderRadius.md,
                border: `1px solid ${searchFocused ? colors.accent.blue : 'rgba(255,255,255,0.12)'}`,
                background: searchFocused ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
                color: '#FFFFFF',
                fontSize: font.size.base,
                fontFamily: font.family,
                outline: 'none',
                transition: transitions.fast,
                boxShadow: searchFocused ? `0 0 0 3px ${colors.accent.blue}22` : 'none',
              }}
            />
          </div>
        )}
      </div>

      {/* Right: Actions */}
      <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center' }}>
        {activeView === 'empresas' && (
          <>
            {/* Cerebro AI */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onOpenCerebro}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 14px',
                borderRadius: layout.borderRadius.sm,
                border: 'none',
                background: `linear-gradient(135deg, ${colors.accent.purple}, ${colors.accent.blue})`,
                color: '#FFFFFF',
                fontSize: font.size.sm,
                fontWeight: font.weight.bold,
                cursor: 'pointer',
                fontFamily: font.family,
              }}
            >
              <Brain size={14} />
              Cerebro
            </motion.button>

            {/* Export CSV */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onExportCSV}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '7px 12px',
                borderRadius: layout.borderRadius.sm,
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.06)',
                color: '#FFFFFF',
                fontSize: font.size.sm,
                fontWeight: font.weight.semibold,
                cursor: 'pointer',
                fontFamily: font.family,
              }}
            >
              <Download size={13} />
              CSV ({filteredCount})
            </motion.button>

            {/* Cleanup */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onToggleCleanup}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '7px 12px',
                borderRadius: layout.borderRadius.sm,
                border: cleanupMode ? 'none' : '1px solid rgba(255,255,255,0.15)',
                background: cleanupMode
                  ? `linear-gradient(135deg, ${colors.accent.red}, ${colors.accent.orange})`
                  : 'rgba(255,255,255,0.06)',
                color: '#FFFFFF',
                fontSize: font.size.sm,
                fontWeight: font.weight.semibold,
                cursor: 'pointer',
                fontFamily: font.family,
              }}
            >
              <Trash2 size={13} />
              {cleanupMode ? 'ON' : 'Limpieza'}
            </motion.button>
          </>
        )}

        {/* User avatar */}
        {currentUser && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onOpenSettings}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 12px 5px 5px',
              borderRadius: layout.borderRadius.full,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.06)',
              cursor: 'pointer',
              fontFamily: font.family,
            }}
          >
            <div style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: `linear-gradient(135deg, ${colors.accent.blue}, ${colors.accent.green})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: font.weight.bold,
              color: '#FFFFFF',
            }}>
              {currentUser.name?.split(' ').map((w: string) => w[0]).join('').toUpperCase()}
            </div>
            <span style={{
              fontSize: font.size.sm,
              fontWeight: font.weight.semibold,
              color: '#FFFFFF',
            }}>
              {currentUser.name?.split(' ')[0]}
            </span>
            {currentUser.isAdmin && (
              <span style={{
                fontSize: 8,
                fontWeight: font.weight.bold,
                color: colors.accent.yellow,
                background: `${colors.accent.yellow}20`,
                padding: '1px 5px',
                borderRadius: 4,
              }}>ADMIN</span>
            )}
          </motion.button>
        )}
      </div>
    </header>
  );
}
