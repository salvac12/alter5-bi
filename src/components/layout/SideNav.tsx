import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2,
  Users,
  BarChart2,
  TrendingUp,
  Link2,
  UserSearch,
  Megaphone,
  Cpu,
  ChevronDown,
  FileText,
  Send,
  GitMerge,
  CheckCircle2,
} from 'lucide-react';
import { colors, font, layout, transitions } from '../../theme/tokens';
import type { ViewId } from '../../types';

/* ─── Types ─────────────────────────────────────────────────── */

interface SideNavProps {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
}

interface NavItemDef {
  id: ViewId;
  label: string;
  icon: React.ReactNode;
  children?: NavChildDef[];
}

interface NavChildDef {
  id: ViewId;
  label: string;
  icon: React.ReactNode;
}

interface NavSectionDef {
  title: string;
  items: NavItemDef[];
}

/* ─── Accent color map ──────────────────────────────────────── */

const ACCENT: Record<string, string> = {
  empresas: '#FFFFFF',
  pipeline: '#FFFFFF',
  prospects: '#FFFFFF',
  structuring: '#FFFFFF',
  distribution: '#FFFFFF',
  closing: '#FFFFFF',
  campanas: colors.accent.orange,
  'bridge-campaigns': colors.accent.orange,
  'bridge-explorer': colors.accent.orange,
  candidates: colors.accent.orange,
  prospeccion: colors.accent.cyan,
  analysis: colors.accent.purple,
};

const getAccent = (id: ViewId): string => ACCENT[id] || '#FFFFFF';

/* ─── Navigation structure ──────────────────────────────────── */

const NAV_SECTIONS: NavSectionDef[] = [
  {
    title: 'Business Intelligence',
    items: [
      { id: 'empresas', label: 'Empresas', icon: <Building2 size={16} /> },
    ],
  },
  {
    title: 'Ventas',
    items: [
      {
        id: 'pipeline',
        label: 'Pipeline',
        icon: <GitMerge size={16} />,
        children: [
          { id: 'prospects', label: 'Prospects', icon: <Users size={13} /> },
          { id: 'structuring', label: 'Structuring', icon: <FileText size={13} /> },
          { id: 'distribution', label: 'Distribution', icon: <Send size={13} /> },
          { id: 'closing', label: 'Closing', icon: <CheckCircle2 size={13} /> },
        ],
      },
    ],
  },
  {
    title: 'Marketing',
    items: [
      {
        id: 'campanas',
        label: 'Campanas',
        icon: <Megaphone size={16} />,
        children: [
          { id: 'bridge-campaigns', label: 'Activas', icon: <Megaphone size={13} /> },
          { id: 'candidates', label: 'Nueva Campaña', icon: <Send size={13} /> },
        ],
      },
    ],
  },
  {
    title: 'Herramientas',
    items: [
      { id: 'prospeccion', label: 'Company Search', icon: <Cpu size={16} /> },
      { id: 'analysis', label: 'Analisis', icon: <BarChart2 size={16} /> },
    ],
  },
];

/* ─── Pill spring config ────────────────────────────────────── */

const PILL_SPRING = { type: 'spring' as const, stiffness: 380, damping: 34, mass: 0.8 };

/* ─── Helpers ───────────────────────────────────────────────── */

/** Get all flat item IDs that belong to a parent (includes parent + children) */
const getParentFamily = (item: NavItemDef): ViewId[] => {
  const ids: ViewId[] = [item.id];
  if (item.children) item.children.forEach(c => ids.push(c.id));
  return ids;
};

/** Check whether activeView falls within a parent's children */
const isChildActive = (item: NavItemDef, activeView: ViewId): boolean => {
  if (!item.children) return false;
  return item.children.some(c => c.id === activeView);
};

/* ─── Component ─────────────────────────────────────────────── */

export default function SideNav({ activeView, onViewChange }: SideNavProps) {
  const [hoveredId, setHoveredId] = useState<ViewId | null>(null);
  const [expandedParent, setExpandedParent] = useState<ViewId | null>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pillRect, setPillRect] = useState<{ top: number; height: number } | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // Auto-expand parent if a child is active
  useEffect(() => {
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        if (item.children && (item.id === activeView || isChildActive(item, activeView))) {
          setExpandedParent(item.id);
          return;
        }
      }
    }
  }, [activeView]);

  // Measure active item position for sliding pill
  const measureActive = useCallback(() => {
    const activeId = activeView;
    const el = itemRefs.current[activeId];
    const nav = navRef.current;
    if (el && nav) {
      const navRect = nav.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      setPillRect({
        top: elRect.top - navRect.top,
        height: elRect.height,
      });
    }
  }, [activeView]);

  useEffect(() => {
    // Small delay to let AnimatePresence finish expanding children
    const t = setTimeout(measureActive, 60);
    return () => clearTimeout(t);
  }, [activeView, expandedParent, measureActive]);

  // Also measure on resize
  useEffect(() => {
    window.addEventListener('resize', measureActive);
    return () => window.removeEventListener('resize', measureActive);
  }, [measureActive]);

  const activeAccent = getAccent(activeView);

  const handleItemClick = (item: NavItemDef) => {
    if (item.children) {
      // Toggle expand; if collapsing the active parent, navigate to parent view
      if (expandedParent === item.id) {
        setExpandedParent(null);
      } else {
        setExpandedParent(item.id);
      }
      // Always navigate to the parent view
      onViewChange(item.id);
    } else {
      onViewChange(item.id);
    }
  };

  const handleChildClick = (child: NavChildDef) => {
    onViewChange(child.id);
  };

  /* ─── Render helpers ───────────────────────────────────── */

  const renderItem = (item: NavItemDef) => {
    const isActive = activeView === item.id && !isChildActive(item, activeView);
    const hasActiveChild = isChildActive(item, activeView);
    const isHighlighted = isActive || hasActiveChild;
    const isHovered = hoveredId === item.id;
    const accent = getAccent(item.id);
    const isExpanded = expandedParent === item.id;

    return (
      <div key={item.id}>
        <button
          ref={el => { itemRefs.current[item.id] = el; }}
          onClick={() => handleItemClick(item)}
          onMouseEnter={() => setHoveredId(item.id)}
          onMouseLeave={() => setHoveredId(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            width: '100%',
            height: 40,
            padding: '0 14px',
            border: 'none',
            background: isHovered && !isActive ? 'rgba(255,255,255,0.04)' : 'none',
            cursor: 'pointer',
            fontFamily: font.family,
            position: 'relative',
            borderRadius: '8px',
            transition: 'background 0.15s ease',
          }}
        >
          {/* Icon */}
          <span style={{
            color: isActive ? accent : isHighlighted ? accent : isHovered ? accent : '#6B7F94',
            display: 'flex',
            alignItems: 'center',
            position: 'relative',
            zIndex: 2,
            transition: 'color 0.15s ease',
            flexShrink: 0,
          }}>
            {item.icon}
          </span>

          {/* Label */}
          <span style={{
            fontSize: '13px',
            fontWeight: isActive ? 600 : 500,
            color: isActive ? '#FFFFFF' : isHighlighted ? '#FFFFFF' : isHovered ? '#CBD5E1' : '#94A3B8',
            position: 'relative',
            zIndex: 2,
            transition: 'color 0.15s ease',
            flex: 1,
            textAlign: 'left',
          }}>
            {item.label}
          </span>

          {/* Expand chevron for parents */}
          {item.children && (
            <motion.span
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
              style={{
                display: 'flex',
                alignItems: 'center',
                color: '#6B7F94',
                position: 'relative',
                zIndex: 2,
                flexShrink: 0,
              }}
            >
              <ChevronDown size={12} />
            </motion.span>
          )}
        </button>

        {/* Children */}
        {item.children && (
          <AnimatePresence initial={false}>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ paddingTop: '2px' }}>
                  {item.children.map(child => renderChild(child, item))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    );
  };

  const renderChild = (child: NavChildDef, _parent: NavItemDef) => {
    const isActive = activeView === child.id;
    const isHovered = hoveredId === child.id;
    const accent = getAccent(child.id);

    return (
      <button
        key={child.id}
        ref={el => { itemRefs.current[child.id] = el; }}
        onClick={() => handleChildClick(child)}
        onMouseEnter={() => setHoveredId(child.id)}
        onMouseLeave={() => setHoveredId(null)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
          height: 34,
          padding: '0 14px 0 38px',
          border: 'none',
          background: isHovered && !isActive ? 'rgba(255,255,255,0.04)' : 'none',
          cursor: 'pointer',
          fontFamily: font.family,
          position: 'relative',
          borderRadius: '8px',
          transition: 'background 0.15s ease',
        }}
      >
        {/* Icon */}
        <span style={{
          color: isActive ? accent : isHovered ? accent : '#6B7F94',
          display: 'flex',
          alignItems: 'center',
          position: 'relative',
          zIndex: 2,
          transition: 'color 0.15s ease',
          flexShrink: 0,
        }}>
          {child.icon}
        </span>

        {/* Label */}
        <span style={{
          fontSize: '12px',
          fontWeight: isActive ? 600 : 500,
          color: isActive ? '#FFFFFF' : isHovered ? '#CBD5E1' : '#94A3B8',
          position: 'relative',
          zIndex: 2,
          transition: 'color 0.15s ease',
          textAlign: 'left',
        }}>
          {child.label}
        </span>
      </button>
    );
  };

  return (
    <nav
      ref={navRef}
      style={{
        position: 'fixed',
        top: layout.headerHeight,
        left: 0,
        bottom: 0,
        width: layout.sideNavWidth,
        background: 'rgba(0,0,0,0.18)',
        borderRight: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 10px 16px',
        overflowY: 'auto',
        overflowX: 'hidden',
        zIndex: 50,
        flexShrink: 0,
      }}
    >
      {/* Sliding pill */}
      <AnimatePresence>
        {pillRect && (
          <motion.div
            layoutId="sidenav-pill"
            animate={{
              top: pillRect.top,
              height: pillRect.height,
            }}
            transition={PILL_SPRING}
            style={{
              position: 'absolute',
              left: 10,
              right: 10,
              borderRadius: 8,
              background: `${activeAccent}12`,
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
        )}
      </AnimatePresence>

      {/* Active edge indicator (right side bar) */}
      <AnimatePresence>
        {pillRect && (
          <motion.div
            layoutId="sidenav-edge"
            animate={{
              top: pillRect.top + 8,
              height: pillRect.height - 16,
            }}
            transition={PILL_SPRING}
            style={{
              position: 'absolute',
              right: 0,
              width: 3,
              borderRadius: '2px 0 0 2px',
              background: activeAccent,
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
        )}
      </AnimatePresence>

      {/* Nav sections */}
      {NAV_SECTIONS.map((section, sIdx) => (
        <div key={section.title} style={{ marginBottom: sIdx < NAV_SECTIONS.length - 1 ? '16px' : 0 }}>
          {/* Section label */}
          <div style={{
            padding: '8px 14px 6px',
            fontSize: '10px',
            fontWeight: 600,
            color: '#4A5568',
            textTransform: 'uppercase',
            letterSpacing: '1.2px',
            fontFamily: font.family,
            userSelect: 'none',
          }}>
            {section.title}
          </div>

          {/* Items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {section.items.map(item => renderItem(item))}
          </div>
        </div>
      ))}
    </nav>
  );
}
