import { useState } from 'react';
import { Sparkles, Search, Download, Trash2 } from 'lucide-react';
import alter5Logo from '../../assets/alter5-logo.svg';
import { colors, font, layout, spacing, transitions } from '../../theme/tokens';
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

  const initials = currentUser?.name
    ?.split(' ')
    .map((w: string) => w[0])
    .join('')
    .toUpperCase() || '?';

  return (
    <header style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: layout.headerHeight,
      background: colors.headerBg,
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderBottom: '1px solid rgba(255,255,255,0.1)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: `0 ${spacing.xl}`,
      zIndex: 100,
      flexShrink: 0,
    }}>
      {/* Left: Logo + Badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <img
          src={alter5Logo}
          alt="Alter5 BI"
          style={{ height: 26, filter: 'brightness(0) invert(1)' }}
        />
        <div style={{
          height: 20,
          width: 1,
          background: 'rgba(255,255,255,0.15)',
        }} />
        <div style={{
          background: 'rgba(255,255,255,0.08)',
          borderRadius: 5,
          padding: '3px 8px',
          fontSize: 9,
          fontWeight: 700,
          color: 'rgba(255,255,255,0.6)',
          fontFamily: font.family,
          letterSpacing: '0.08em',
          textTransform: 'uppercase' as const,
        }}>
          B2B SaaS Dashboard
        </div>
      </div>

      {/* Right: Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {activeView === 'empresas' && (
          <>
            {/* Cerebro AI */}
            <button
              onClick={onOpenCerebro}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(139,92,246,0.15)',
                border: '1px solid rgba(139,92,246,0.3)',
                borderRadius: 7,
                padding: '6px 11px',
                fontSize: 12,
                fontWeight: 600,
                color: '#C4B5FD',
                fontFamily: font.family,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <Sparkles size={12} />
              Cerebro AI
            </button>

            {/* Export CSV */}
            <button
              onClick={onExportCSV}
              title={`Exportar CSV (${filteredCount})`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 30,
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 7,
                color: 'rgba(255,255,255,0.8)',
                cursor: 'pointer',
                transition: 'all 0.2s',
                padding: 0,
                fontFamily: font.family,
              }}
            >
              <Download size={13} />
            </button>

            {/* Cleanup */}
            <button
              onClick={onToggleCleanup}
              title={cleanupMode ? 'Desactivar limpieza' : 'Modo limpieza'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 30,
                background: cleanupMode
                  ? `linear-gradient(135deg, ${colors.accent.red}, ${colors.accent.orange})`
                  : 'rgba(255,255,255,0.08)',
                border: cleanupMode ? 'none' : '1px solid rgba(255,255,255,0.12)',
                borderRadius: 7,
                color: '#FFFFFF',
                cursor: 'pointer',
                transition: 'all 0.2s',
                padding: 0,
                fontFamily: font.family,
              }}
            >
              <Trash2 size={13} />
            </button>
          </>
        )}

        {/* Search (always visible) */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search
            size={13}
            color={searchFocused ? colors.accent.blue : '#94A3B8'}
            style={{ position: 'absolute', left: 9, pointerEvents: 'none' }}
          />
          <input
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Buscar..."
            style={{
              background: searchFocused ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
              border: searchFocused ? `1px solid ${colors.accent.blue}` : '1px solid transparent',
              borderRadius: 7,
              padding: '6px 11px 6px 28px',
              fontSize: 12,
              fontFamily: font.family,
              color: '#FFFFFF',
              outline: 'none',
              width: 160,
              transition: 'all 0.2s',
            }}
          />
        </div>

        {/* Separator + User Avatar */}
        {currentUser && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            paddingLeft: 6,
            borderLeft: '1px solid rgba(255,255,255,0.1)',
          }}>
            <div
              onClick={onOpenSettings}
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 700,
                color: '#13285B',
                fontFamily: font.family,
                cursor: 'pointer',
                boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
              }}
            >
              {initials}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
