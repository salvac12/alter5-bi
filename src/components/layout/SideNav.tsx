import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2,
  Users,
  BarChart3,
  Mail,
  Search as SearchIcon,
  TrendingUp,
  Link2,
  UserSearch,
  ChevronDown,
} from 'lucide-react';
import { colors, font, layout, spacing, transitions } from '../../theme/tokens';
import type { ViewId } from '../../types';

interface SideNavProps {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
}

interface NavSection {
  title: string;
  items: NavItemDef[];
}

interface NavItemDef {
  id: ViewId;
  label: string;
  icon: React.ReactNode;
  badge?: string;
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'CRM',
    items: [
      { id: 'empresas', label: 'Empresas', icon: <Building2 size={18} /> },
      { id: 'prospects', label: 'Prospects', icon: <Users size={18} />, badge: 'PR' },
      { id: 'pipeline', label: 'Pipeline', icon: <TrendingUp size={18} />, badge: 'AT' },
    ],
  },
  {
    title: 'Marketing',
    items: [
      { id: 'campanas', label: 'Campanas', icon: <Mail size={18} />, badge: 'EM' },
      { id: 'bridge-campaigns', label: 'Bridge', icon: <Link2 size={18} /> },
    ],
  },
  {
    title: 'Herramientas',
    items: [
      { id: 'prospeccion', label: 'Prospeccion', icon: <SearchIcon size={18} />, badge: 'IA' },
      { id: 'candidates', label: 'Candidatos', icon: <UserSearch size={18} /> },
      { id: 'analysis', label: 'Analisis', icon: <BarChart3 size={18} /> },
    ],
  },
];

const ACCENT_FOR_VIEW: Record<string, string> = {
  empresas: colors.accent.blue,
  prospects: colors.accent.purple,
  pipeline: colors.accent.green,
  campanas: colors.accent.orange,
  'bridge-campaigns': colors.accent.orange,
  'bridge-explorer': colors.accent.orange,
  prospeccion: colors.accent.green,
  candidates: colors.accent.cyan,
  analysis: colors.accent.blue,
};

export default function SideNav({ activeView, onViewChange }: SideNavProps) {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const toggleSection = (title: string) => {
    setCollapsedSections(prev => ({ ...prev, [title]: !prev[title] }));
  };

  const activeAccent = ACCENT_FOR_VIEW[activeView] || colors.accent.blue;

  return (
    <nav style={{
      position: 'fixed',
      top: layout.headerHeight,
      left: 0,
      bottom: 0,
      width: layout.sideNavWidth,
      background: colors.appBg,
      borderRight: '1px solid rgba(255,255,255,0.06)',
      display: 'flex',
      flexDirection: 'column',
      padding: `${spacing.lg} 0`,
      overflowY: 'auto',
      zIndex: 50,
    }}>
      {NAV_SECTIONS.map(section => (
        <div key={section.title} style={{ marginBottom: spacing.lg }}>
          {/* Section header */}
          <button
            onClick={() => toggleSection(section.title)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: `${spacing.xs} ${spacing.lg}`,
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontFamily: font.family,
            }}
          >
            <span style={{
              fontSize: font.size.xs,
              fontWeight: font.weight.semibold,
              color: colors.text.onDarkMuted,
              textTransform: 'uppercase',
              letterSpacing: '1px',
            }}>
              {section.title}
            </span>
            <motion.div
              animate={{ rotate: collapsedSections[section.title] ? -90 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown size={12} color={colors.text.onDarkMuted} />
            </motion.div>
          </button>

          {/* Items */}
          <AnimatePresence initial={false}>
            {!collapsedSections[section.title] && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{ overflow: 'hidden' }}
              >
                {section.items.map(item => {
                  const isActive = activeView === item.id;
                  const accent = ACCENT_FOR_VIEW[item.id] || colors.accent.blue;

                  return (
                    <motion.button
                      key={item.id}
                      onClick={() => onViewChange(item.id)}
                      whileHover={{ x: 2 }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: spacing.md,
                        width: '100%',
                        padding: `${spacing.sm} ${spacing.lg}`,
                        paddingLeft: spacing.xl,
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        fontFamily: font.family,
                        position: 'relative',
                      }}
                    >
                      {/* Active pill background */}
                      {isActive && (
                        <motion.div
                          layoutId="nav-pill"
                          style={{
                            position: 'absolute',
                            inset: '2px 8px',
                            background: `${accent}15`,
                            borderRadius: layout.borderRadius.sm,
                          }}
                          transition={transitions.spring}
                        />
                      )}

                      {/* Active edge indicator */}
                      {isActive && (
                        <motion.div
                          layoutId="nav-edge"
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: '20%',
                            bottom: '20%',
                            width: 3,
                            background: accent,
                            borderRadius: '0 3px 3px 0',
                          }}
                          transition={transitions.spring}
                        />
                      )}

                      {/* Icon */}
                      <span style={{
                        color: isActive ? accent : colors.text.onDarkMuted,
                        display: 'flex',
                        alignItems: 'center',
                        position: 'relative',
                        zIndex: 1,
                        transition: transitions.fast,
                      }}>
                        {item.icon}
                      </span>

                      {/* Label */}
                      <span style={{
                        fontSize: font.size.base,
                        fontWeight: isActive ? font.weight.semibold : font.weight.medium,
                        color: isActive ? '#FFFFFF' : colors.text.onDarkSecondary,
                        position: 'relative',
                        zIndex: 1,
                        transition: transitions.fast,
                      }}>
                        {item.label}
                      </span>

                      {/* Badge */}
                      {item.badge && (
                        <span style={{
                          marginLeft: 'auto',
                          fontSize: 8,
                          fontWeight: font.weight.bold,
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: isActive ? `${accent}25` : 'rgba(255,255,255,0.06)',
                          color: isActive ? accent : colors.text.onDarkMuted,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          position: 'relative',
                          zIndex: 1,
                        }}>
                          {item.badge}
                        </span>
                      )}
                    </motion.button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </nav>
  );
}
