/* ═══════════════════════════════════════════════════════════════
   OnboardingWizard — 4-step onboarding flow
   ═══════════════════════════════════════════════════════════════ */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Sparkles, Layout, Building2, GitBranch, Brain, Rocket,
  ChevronRight, ChevronLeft,
} from 'lucide-react';
import { colors, font, layout, spacing, shadows, transitions } from '../../theme/tokens';

// ── Types ───────────────────────────────────────────────────────

interface OnboardingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

// ── Step data ───────────────────────────────────────────────────

interface StepConfig {
  icon: typeof Sparkles;
  iconColor: string;
  title: string;
  subtitle: string;
  items?: { icon: typeof Building2; label: string; desc: string }[];
}

const STEPS: StepConfig[] = [
  {
    icon: Sparkles,
    iconColor: colors.accent.purple,
    title: 'Bienvenido a Alter5 BI',
    subtitle: 'Tu plataforma de inteligencia comercial para financiacion de energias renovables. En unos pasos te mostramos como sacar el maximo partido.',
  },
  {
    icon: Layout,
    iconColor: colors.accent.blue,
    title: 'Navegacion',
    subtitle: 'El panel lateral izquierdo te da acceso rapido a todas las secciones. Puedes colapsarlo para ganar espacio de trabajo.',
  },
  {
    icon: Rocket,
    iconColor: colors.accent.green,
    title: 'Funciones principales',
    subtitle: 'Estas son las herramientas que usaras a diario:',
    items: [
      { icon: Building2, label: 'Empresas', desc: 'CRM con +3,000 empresas clasificadas por IA' },
      { icon: GitBranch, label: 'Pipeline', desc: 'Kanban con 9 fases para gestionar deals activos' },
      { icon: Brain, label: 'Cerebro AI', desc: 'Asistente inteligente que responde sobre tu cartera' },
    ],
  },
  {
    icon: Rocket,
    iconColor: colors.accent.orange,
    title: 'Todo listo',
    subtitle: 'Ya estas preparado para explorar la plataforma. Si necesitas ayuda en cualquier momento, pulsa Ctrl+/ para abrir la guia.',
  },
];

// ── Component ───────────────────────────────────────────────────

export function OnboardingWizard({ isOpen, onClose, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1); // 1 = forward, -1 = back
  const total = STEPS.length;
  const current = STEPS[step];
  const isLast = step === total - 1;

  const goNext = () => {
    if (isLast) {
      onComplete();
      return;
    }
    setDirection(1);
    setStep(s => s + 1);
  };

  const goBack = () => {
    setDirection(-1);
    setStep(s => Math.max(0, s - 1));
  };

  // ── Styles ──────────────────────────────────────────────────

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9600,
    padding: spacing.xl,
  };

  const modalStyle: React.CSSProperties = {
    background: colors.dark.bg,
    borderRadius: layout.borderRadius.xl,
    border: `1px solid ${colors.dark.border}`,
    maxWidth: 600,
    width: '100%',
    boxShadow: shadows.panel,
    overflow: 'hidden',
    fontFamily: font.family,
  };

  // Progress bar
  const progressContainerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: `${spacing.xl} ${spacing['2xl']} 0`,
  };

  const dotStyle = (i: number): React.CSSProperties => ({
    width: i === step ? 24 : 8,
    height: 8,
    borderRadius: layout.borderRadius.full,
    background: i <= step ? colors.accent.blue : colors.dark.surface,
    transition: transitions.smooth,
  });

  const lineStyle = (i: number): React.CSSProperties => ({
    width: 32,
    height: 2,
    background: i < step ? colors.accent.blue : colors.dark.surface,
    borderRadius: 1,
    transition: transitions.smooth,
  });

  const bodyStyle: React.CSSProperties = {
    padding: `${spacing['2xl']} ${spacing['3xl']} ${spacing.xl}`,
    minHeight: 280,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center' as const,
    position: 'relative',
    overflow: 'hidden',
  };

  const iconCircleStyle: React.CSSProperties = {
    width: 64,
    height: 64,
    borderRadius: layout.borderRadius.full,
    background: `${current.iconColor}15`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: font.size['2xl'],
    fontWeight: font.weight.bold,
    color: colors.text.onDark,
    marginBottom: spacing.md,
  };

  const subtitleStyle: React.CSSProperties = {
    fontSize: font.size.md,
    color: colors.text.onDarkSecondary,
    lineHeight: font.lineHeight.relaxed,
    maxWidth: 440,
    marginBottom: spacing.xl,
  };

  const featureListStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.md,
    width: '100%',
    maxWidth: 440,
    textAlign: 'left' as const,
  };

  const featureRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    background: colors.dark.card,
    borderRadius: layout.borderRadius.md,
    border: `1px solid ${colors.dark.border}`,
  };

  const featureIconStyle: React.CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: layout.borderRadius.md,
    background: `${colors.accent.blue}15`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  };

  const featureLabelStyle: React.CSSProperties = {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text.onDark,
  };

  const featureDescStyle: React.CSSProperties = {
    fontSize: font.size.sm,
    color: colors.text.onDarkSecondary,
    marginTop: 2,
    lineHeight: font.lineHeight.normal,
  };

  const footerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.lg} ${spacing['2xl']} ${spacing.xl}`,
    borderTop: `1px solid ${colors.dark.border}`,
  };

  const skipBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: colors.text.onDarkSecondary,
    fontSize: font.size.sm,
    fontFamily: font.family,
    padding: spacing.sm,
    transition: transitions.fast,
  };

  const navBtnGroup: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
  };

  const backBtnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.xs,
    padding: `${spacing.sm} ${spacing.lg}`,
    borderRadius: layout.borderRadius.md,
    border: `1px solid ${colors.dark.border}`,
    background: 'transparent',
    color: colors.text.onDarkSecondary,
    fontSize: font.size.sm,
    fontWeight: font.weight.medium,
    fontFamily: font.family,
    cursor: 'pointer',
    transition: transitions.fast,
  };

  const nextBtnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.xs,
    padding: `${spacing.sm} ${spacing.xl}`,
    borderRadius: layout.borderRadius.md,
    border: 'none',
    background: isLast
      ? `linear-gradient(135deg, ${colors.accent.blue}, ${colors.accent.green})`
      : colors.accent.blue,
    color: '#fff',
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
    fontFamily: font.family,
    cursor: 'pointer',
    transition: transitions.fast,
    boxShadow: shadows.md,
  };

  // Step transition variants
  const slideVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? 80 : -80, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -80 : 80, opacity: 0 }),
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          style={overlayStyle}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            style={modalStyle}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={transitions.spring}
            onClick={e => e.stopPropagation()}
          >
            {/* Progress dots */}
            <div style={progressContainerStyle}>
              {Array.from({ length: total }).map((_, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                  <div style={dotStyle(i)} />
                  {i < total - 1 && <div style={lineStyle(i)} />}
                </div>
              ))}
            </div>

            {/* Step content */}
            <div style={bodyStyle}>
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={step}
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}
                >
                  <div style={iconCircleStyle}>
                    <current.icon size={28} color={current.iconColor} />
                  </div>
                  <div style={titleStyle}>{current.title}</div>
                  <div style={subtitleStyle}>{current.subtitle}</div>

                  {/* Feature list (step 3) */}
                  {current.items && (
                    <div style={featureListStyle}>
                      {current.items.map((item, i) => (
                        <div key={i} style={featureRowStyle}>
                          <div style={featureIconStyle}>
                            <item.icon size={18} color={colors.accent.blue} />
                          </div>
                          <div>
                            <div style={featureLabelStyle}>{item.label}</div>
                            <div style={featureDescStyle}>{item.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Footer */}
            <div style={footerStyle}>
              <button
                style={skipBtnStyle}
                onClick={onClose}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = colors.text.onDark; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = colors.text.onDarkSecondary; }}
              >
                Saltar
              </button>

              <div style={navBtnGroup}>
                {step > 0 && (
                  <button style={backBtnStyle} onClick={goBack}>
                    <ChevronLeft size={14} />
                    Atras
                  </button>
                )}
                <button style={nextBtnStyle} onClick={goNext}>
                  {isLast ? 'Comenzar' : 'Siguiente'}
                  {!isLast && <ChevronRight size={14} />}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
